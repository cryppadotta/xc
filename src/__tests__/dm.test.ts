/**
 * Tests for DM command registration and mock SDK interactions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerDmCommand } from "../commands/dm.js";

// Mock the API and resolve modules
vi.mock("../lib/api.js", () => ({
  getClient: vi.fn(),
}));

vi.mock("../lib/resolve.js", () => ({
  resolveUserId: vi.fn(),
  resolveAuthenticatedUserId: vi.fn(),
}));

// Suppress cost footer (it reads filesystem)
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
import { resolveUserId, resolveAuthenticatedUserId } from "../lib/resolve.js";

describe("dm command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride(); // Prevent process.exit
    registerDmCommand(program);
    vi.clearAllMocks();
  });

  it("registers dm subcommands", () => {
    const dm = program.commands.find((c) => c.name() === "dm");
    expect(dm).toBeDefined();

    const subNames = dm!.commands.map((c) => c.name());
    expect(subNames).toContain("send");
    expect(subNames).toContain("list");
    expect(subNames).toContain("history");
  });

  it("dm send calls createByParticipantId", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      data: { dmEventId: "evt_123" },
    });

    vi.mocked(resolveUserId).mockResolvedValue("user_456");
    vi.mocked(getClient).mockResolvedValue({
      directMessages: { createByParticipantId: mockCreate },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    // Capture stdout
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["node", "xc", "dm", "send", "@testuser", "hello world"]);

    expect(resolveUserId).toHaveBeenCalledWith("@testuser", undefined);
    expect(mockCreate).toHaveBeenCalledWith("user_456", {
      body: { text: "hello world" },
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("DM sent to @testuser"),
    );

    logSpy.mockRestore();
  });

  it("dm list calls getEvents", async () => {
    const mockGetEvents = vi.fn().mockResolvedValue({
      data: [
        {
          id: "ev1",
          text: "hi",
          senderId: "u1",
          dmConversationId: "conv1",
          createdAt: "2025-01-01T00:00:00Z",
        },
      ],
      includes: {
        users: [{ id: "u1", username: "alice", name: "Alice" }],
      },
    });

    vi.mocked(getClient).mockResolvedValue({
      directMessages: { getEvents: mockGetEvents },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["node", "xc", "dm", "list"]);

    expect(mockGetEvents).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("Recent DM conversations:\n");

    logSpy.mockRestore();
  });

  it("dm history calls getEventsByParticipantId", async () => {
    const mockGetByPart = vi.fn().mockResolvedValue({
      data: [
        {
          id: "ev1",
          text: "hey",
          senderId: "u2",
          createdAt: "2025-01-01T00:00:00Z",
        },
      ],
      includes: {
        users: [{ id: "u2", username: "bob", name: "Bob" }],
      },
    });

    vi.mocked(resolveUserId).mockResolvedValue("u2");
    vi.mocked(resolveAuthenticatedUserId).mockResolvedValue("myid");
    vi.mocked(getClient).mockResolvedValue({
      directMessages: { getEventsByParticipantId: mockGetByPart },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["node", "xc", "dm", "history", "@bob"]);

    expect(mockGetByPart).toHaveBeenCalledWith("u2", expect.objectContaining({
      maxResults: 20,
    }));
    expect(logSpy).toHaveBeenCalledWith("DM history with @bob:\n");

    logSpy.mockRestore();
  });
});
