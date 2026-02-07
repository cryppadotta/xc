/**
 * Tests for bookmarks commands with mocked SDK client.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import {
  registerBookmarksCommand,
  registerBookmarkCommand,
  registerUnbookmarkCommand,
} from "../commands/bookmarks.js";

vi.mock("../lib/api.js", () => ({
  getClient: vi.fn(),
}));

vi.mock("../lib/resolve.js", () => ({
  resolveAuthenticatedUserId: vi.fn(),
  resolveUserId: vi.fn(),
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
import { resolveAuthenticatedUserId } from "../lib/resolve.js";

describe("bookmarks command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerBookmarksCommand(program);
    vi.clearAllMocks();
  });

  it("lists bookmarks", async () => {
    vi.mocked(resolveAuthenticatedUserId).mockResolvedValue("myid");
    const mockGetBookmarks = vi.fn().mockResolvedValue({
      data: [
        {
          id: "t1",
          text: "bookmarked post",
          authorId: "u1",
          createdAt: "2025-01-01T00:00:00Z",
        },
      ],
      includes: {
        users: [{ id: "u1", username: "alice", name: "Alice" }],
      },
    });

    vi.mocked(getClient).mockResolvedValue({
      users: { getBookmarks: mockGetBookmarks },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "xc", "bookmarks"]);

    expect(mockGetBookmarks).toHaveBeenCalledWith("myid", expect.objectContaining({
      maxResults: 20,
    }));
    expect(logSpy).toHaveBeenCalledWith("Bookmarks:\n");
    logSpy.mockRestore();
  });
});

describe("bookmark command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerBookmarkCommand(program);
    vi.clearAllMocks();
  });

  it("adds a bookmark", async () => {
    vi.mocked(resolveAuthenticatedUserId).mockResolvedValue("myid");
    const mockCreate = vi.fn().mockResolvedValue({ data: { bookmarked: true } });

    vi.mocked(getClient).mockResolvedValue({
      users: { createBookmark: mockCreate },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "xc", "bookmark", "12345"]);

    expect(mockCreate).toHaveBeenCalledWith("myid", { tweetId: "12345" });
    expect(logSpy).toHaveBeenCalledWith("Bookmarked post 12345");
    logSpy.mockRestore();
  });
});

describe("unbookmark command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerUnbookmarkCommand(program);
    vi.clearAllMocks();
  });

  it("removes a bookmark", async () => {
    vi.mocked(resolveAuthenticatedUserId).mockResolvedValue("myid");
    const mockDelete = vi.fn().mockResolvedValue({ data: { bookmarked: false } });

    vi.mocked(getClient).mockResolvedValue({
      users: { deleteBookmark: mockDelete },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "xc", "unbookmark", "12345"]);

    expect(mockDelete).toHaveBeenCalledWith("myid", "12345");
    expect(logSpy).toHaveBeenCalledWith("Unbookmarked post 12345");
    logSpy.mockRestore();
  });
});
