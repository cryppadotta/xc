/**
 * Tests for media upload command.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Command } from "commander";
import { registerMediaCommand, uploadMedia } from "../commands/media.js";

vi.mock("../lib/api.js", () => ({
  getClient: vi.fn(),
}));

vi.mock("../lib/resolve.js", () => ({
  resolveUserId: vi.fn(),
  resolveAuthenticatedUserId: vi.fn(),
}));

vi.mock("../lib/cost.js", () => ({
  logApiCall: vi.fn(),
  formatCostFooter: vi.fn(() => ""),
  estimateCost: vi.fn(() => 0),
  loadUsageLog: vi.fn(() => []),
  computeTodaySpend: vi.fn(() => 0),
}));

vi.mock("../lib/budget.js", () => ({
  checkBudget: vi.fn(),
  loadBudget: vi.fn(() => ({ action: "warn" })),
}));

import { getClient } from "../lib/api.js";

describe("media command registration", () => {
  it("registers media upload subcommand", () => {
    const program = new Command();
    program.exitOverride();
    registerMediaCommand(program);

    const media = program.commands.find((c) => c.name() === "media");
    expect(media).toBeDefined();

    const subNames = media!.commands.map((c) => c.name());
    expect(subNames).toContain("upload");
  });
});

describe("uploadMedia", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xc-media-test-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects unsupported file types", async () => {
    const file = path.join(tmpDir, "test.xyz");
    fs.writeFileSync(file, "data");

    await expect(uploadMedia(file)).rejects.toThrow("Unsupported file type");
  });

  it("rejects files exceeding size limit", async () => {
    const file = path.join(tmpDir, "huge.jpg");
    // Create a sparse file that reports > 5MB
    const fd = fs.openSync(file, "w");
    fs.ftruncateSync(fd, 6 * 1024 * 1024);
    fs.closeSync(fd);

    await expect(uploadMedia(file)).rejects.toThrow("File too large");
  });

  it("uses one-shot upload for images", async () => {
    const file = path.join(tmpDir, "photo.jpg");
    fs.writeFileSync(file, Buffer.alloc(1024)); // 1KB image

    const mockUpload = vi.fn().mockResolvedValue({
      data: { id: "media_123" },
    });

    vi.mocked(getClient).mockResolvedValue({
      media: { upload: mockUpload },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    const result = await uploadMedia(file);
    expect(result).toBe("media_123");
    expect(mockUpload).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        mediaType: "image/jpeg",
        mediaCategory: "tweet_image",
      }),
    }));
  });

  it("uses chunked upload for GIFs", async () => {
    const file = path.join(tmpDir, "anim.gif");
    fs.writeFileSync(file, Buffer.alloc(1024));

    const mockInit = vi.fn().mockResolvedValue({ data: { id: "m_456" } });
    const mockAppend = vi.fn().mockResolvedValue({});
    const mockFinalize = vi.fn().mockResolvedValue({ data: {} });

    vi.mocked(getClient).mockResolvedValue({
      media: {
        initializeUpload: mockInit,
        appendUpload: mockAppend,
        finalizeUpload: mockFinalize,
      },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    // Suppress progress output
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await uploadMedia(file);
    expect(result).toBe("m_456");
    expect(mockInit).toHaveBeenCalled();
    expect(mockAppend).toHaveBeenCalledWith("m_456", expect.anything());
    expect(mockFinalize).toHaveBeenCalledWith("m_456");

    vi.mocked(console.error).mockRestore();
  });

  it("polls processing status for videos", async () => {
    const file = path.join(tmpDir, "clip.mp4");
    fs.writeFileSync(file, Buffer.alloc(1024));

    const mockInit = vi.fn().mockResolvedValue({ data: { id: "m_789" } });
    const mockAppend = vi.fn().mockResolvedValue({});
    const mockFinalize = vi.fn().mockResolvedValue({
      data: { processingInfo: { state: "pending", checkAfterSecs: 0 } },
    });
    const mockStatus = vi.fn().mockResolvedValue({
      data: { processingInfo: { state: "succeeded" } },
    });

    vi.mocked(getClient).mockResolvedValue({
      media: {
        initializeUpload: mockInit,
        appendUpload: mockAppend,
        finalizeUpload: mockFinalize,
        getUploadStatus: mockStatus,
      },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    // Suppress progress output
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await uploadMedia(file);
    expect(result).toBe("m_789");
    expect(mockFinalize).toHaveBeenCalledWith("m_789");
    expect(mockStatus).toHaveBeenCalledWith("m_789", expect.objectContaining({
      command: "STATUS",
    }));

    vi.mocked(console.error).mockRestore();
  });
});
