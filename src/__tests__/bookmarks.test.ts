/**
 * Tests for bookmark command wiring.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import {
  registerBookmarkCommand,
  registerBookmarksCommand,
  registerUnbookmarkCommand,
} from "../commands/bookmarks.js";

vi.mock("../lib/api.js", () => ({
  getClient: vi.fn(),
}));

vi.mock("../lib/resolve.js", () => ({
  resolveAuthenticatedUserId: vi.fn(),
}));

vi.mock("../lib/cost.js", () => ({
  logApiCall: vi.fn(),
  formatCostFooter: vi.fn(() => ""),
  estimateCost: vi.fn(() => 0),
  loadUsageLog: vi.fn(() => []),
  computeTodaySpend: vi.fn(() => 0),
  getSessionCost: vi.fn(() => ({ endpoints: [], total: 0 })),
  outputJson: vi.fn(),
}));

vi.mock("../lib/budget.js", () => ({
  checkBudget: vi.fn(),
  loadBudget: vi.fn(() => ({ action: "warn" })),
}));

vi.mock("../bookmarks/sync.js", () => ({
  syncLocalBookmarks: vi.fn(),
  cacheBookmarkedPosts: vi.fn(),
}));

vi.mock("../bookmarks/store.js", () => ({
  BookmarkStore: {
    open: vi.fn(),
    parseMetrics: vi.fn(() => ({})),
    summarizeText: vi.fn((row: { fullText?: string; text?: string }) => row.fullText || row.text || ""),
  },
}));

import { getClient } from "../lib/api.js";
import { resolveAuthenticatedUserId } from "../lib/resolve.js";
import { cacheBookmarkedPosts, syncLocalBookmarks } from "../bookmarks/sync.js";
import { BookmarkStore } from "../bookmarks/store.js";

describe("bookmarks remote command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerBookmarksCommand(program);
    vi.clearAllMocks();
  });

  it("lists remote bookmarks", async () => {
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
    await program.parseAsync(["node", "xc", "bookmarks", "remote"]);

    expect(mockGetBookmarks).toHaveBeenCalledWith(
      "myid",
      expect.objectContaining({ maxResults: 20 }),
    );
    expect(logSpy).toHaveBeenCalledWith("Bookmarks:\n");
    logSpy.mockRestore();
  });
});

describe("bookmarks local sync command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerBookmarksCommand(program);
    vi.clearAllMocks();
  });

  it("runs local sync", async () => {
    vi.mocked(syncLocalBookmarks).mockResolvedValue({
      pagesFetched: 2,
      bookmarksSeen: 150,
      postsHydrated: 150,
      stopReason: "cutoff",
      lastSyncAt: "2026-03-23T00:00:00.000Z",
      days: 30,
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "xc", "bookmarks", "local", "sync"]);

    expect(syncLocalBookmarks).toHaveBeenCalledWith({
      accountName: undefined,
      days: 30,
      maxPages: 0,
    });
    expect(logSpy).toHaveBeenCalledWith(
      "Synced 150 bookmarks in 2 pages (30d target window).",
    );
    logSpy.mockRestore();
  });

  it("prints local status", async () => {
    vi.mocked(BookmarkStore.open).mockReturnValue({
      getStatus: () => ({
        dbPath: "/tmp/bookmarks.db",
        bookmarkCount: 10,
        postCount: 12,
        userCount: 2,
        mediaCount: 1,
        fulltextCount: 8,
        lastSyncAt: "2026-03-23T00:00:00.000Z",
        lastSyncDays: 30,
        oldestFulltextCreatedAt: "2026-02-20T00:00:00.000Z",
        headWindow: ["a", "b"],
        hasCompletedSync: true,
      }),
      close: () => {},
    } as any);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "xc", "bookmarks", "local", "status"]);

    expect(logSpy).toHaveBeenCalledWith("db=/tmp/bookmarks.db");
    expect(logSpy).toHaveBeenCalledWith("bookmarks=10");
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

  it("adds a bookmark and updates the local cache", async () => {
    vi.mocked(resolveAuthenticatedUserId).mockResolvedValue("myid");
    const mockCreate = vi.fn().mockResolvedValue({ data: { bookmarked: true } });

    vi.mocked(getClient).mockResolvedValue({
      users: { createBookmark: mockCreate },
    } as unknown as Awaited<ReturnType<typeof getClient>>);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["node", "xc", "bookmark", "12345"]);

    expect(mockCreate).toHaveBeenCalledWith("myid", { tweetId: "12345" });
    expect(cacheBookmarkedPosts).toHaveBeenCalledWith(["12345"], undefined);
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
