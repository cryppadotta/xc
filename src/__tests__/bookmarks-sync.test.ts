/**
 * Tests for bookmark sync state and hydration behavior.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;
let originalConfigDir: string | undefined;

const mockGetClient = vi.fn();
const mockResolveAuthenticatedUserId = vi.fn();

vi.mock("../lib/api.js", () => ({
  getClient: mockGetClient,
}));

vi.mock("../lib/resolve.js", () => ({
  resolveAuthenticatedUserId: mockResolveAuthenticatedUserId,
}));

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xc-bookmark-sync-"));
  originalConfigDir = process.env.XC_CONFIG_DIR;
  process.env.XC_CONFIG_DIR = tmpDir;
  vi.resetModules();
  mockGetClient.mockReset();
  mockResolveAuthenticatedUserId.mockReset();
  mockResolveAuthenticatedUserId.mockResolvedValue("me");
});

afterEach(() => {
  if (originalConfigDir !== undefined) {
    process.env.XC_CONFIG_DIR = originalConfigDir;
  } else {
    delete process.env.XC_CONFIG_DIR;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("syncLocalBookmarks", () => {
  it("uses the head window for incremental sync and avoids rehydrating full posts", async () => {
    const firstGetBookmarks = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            id: "100",
            authorId: "u1",
            createdAt: "2026-03-22T00:00:00.000Z",
            text: "new post",
            publicMetrics: { likeCount: 1 },
          },
        ],
        includes: {
          users: [{ id: "u1", username: "alice", name: "Alice" }],
          tweets: [
            {
              id: "050",
              authorId: "u1",
              createdAt: "2026-03-20T00:00:00.000Z",
              text: "referenced source",
            },
          ],
        },
        meta: { nextToken: "p2" },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "090",
            authorId: "u1",
            createdAt: "2026-01-01T00:00:00.000Z",
            text: "old post",
            publicMetrics: { likeCount: 2 },
          },
        ],
        includes: {
          users: [{ id: "u1", username: "alice", name: "Alice" }],
        },
        meta: {},
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "100",
            authorId: "u1",
            createdAt: "2026-03-22T00:00:00.000Z",
            text: "new post",
            publicMetrics: { likeCount: 1 },
          },
        ],
        includes: {
          users: [{ id: "u1", username: "alice", name: "Alice" }],
        },
        meta: { nextToken: "ignored" },
      });

    const getByIds = vi
      .fn()
      .mockResolvedValue({
        data: [
          {
            id: "100",
            authorId: "u1",
            createdAt: "2026-03-22T00:00:00.000Z",
            text: "new post",
            noteTweet: { text: "new post long form" },
            publicMetrics: { likeCount: 1 },
          },
          {
            id: "090",
            authorId: "u1",
            createdAt: "2026-01-01T00:00:00.000Z",
            text: "old post",
            publicMetrics: { likeCount: 2 },
          },
        ],
        includes: {
          users: [{ id: "u1", username: "alice", name: "Alice" }],
        },
      });

    mockGetClient.mockResolvedValue({
      users: { getBookmarks: firstGetBookmarks },
      posts: { getByIds },
    });

    const syncModule = await import("../bookmarks/sync.js");
    const storeModule = await import("../bookmarks/store.js");

    const first = await syncModule.syncLocalBookmarks({ days: 30 });
    expect(first.pagesFetched).toBe(2);
    expect(first.postsHydrated).toBe(2);
    expect(first.stopReason).toBe("exhausted");
    expect(getByIds).toHaveBeenCalledTimes(1);

    const second = await syncModule.syncLocalBookmarks({ days: 30 });
    expect(second.pagesFetched).toBe(1);
    expect(second.stopReason).toBe("head_window");
    expect(getByIds).toHaveBeenCalledTimes(1);

    const store = storeModule.BookmarkStore.open();
    try {
      const status = store.getStatus();
      expect(status.lastSyncDays).toBe(30);
      expect(status.headWindow).toEqual(["100"]);
      expect(status.bookmarkCount).toBe(2);
      expect(status.postCount).toBe(3);
    } finally {
      store.close();
    }
  });

  it("extends the coverage window without rehydrating already-complete posts", async () => {
    const getBookmarks = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            id: "200",
            authorId: "u1",
            createdAt: "2026-03-22T00:00:00.000Z",
            text: "recent",
          },
        ],
        includes: { users: [{ id: "u1", username: "alice", name: "Alice" }] },
        meta: { nextToken: "p2" },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "150",
            authorId: "u1",
            createdAt: "2026-02-15T00:00:00.000Z",
            text: "older",
          },
        ],
        includes: { users: [{ id: "u1", username: "alice", name: "Alice" }] },
        meta: { nextToken: "p3" },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "120",
            authorId: "u1",
            createdAt: "2025-12-15T00:00:00.000Z",
            text: "much older",
          },
        ],
        includes: { users: [{ id: "u1", username: "alice", name: "Alice" }] },
        meta: {},
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "200",
            authorId: "u1",
            createdAt: "2026-03-22T00:00:00.000Z",
            text: "recent",
          },
        ],
        includes: { users: [{ id: "u1", username: "alice", name: "Alice" }] },
        meta: { nextToken: "p2" },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "150",
            authorId: "u1",
            createdAt: "2026-02-15T00:00:00.000Z",
            text: "older",
          },
        ],
        includes: { users: [{ id: "u1", username: "alice", name: "Alice" }] },
        meta: { nextToken: "p3" },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "120",
            authorId: "u1",
            createdAt: "2025-12-15T00:00:00.000Z",
            text: "much older",
          },
          {
            id: "110",
            authorId: "u1",
            createdAt: "2025-11-15T00:00:00.000Z",
            text: "newly extended",
          },
        ],
        includes: { users: [{ id: "u1", username: "alice", name: "Alice" }] },
        meta: {},
      });

    const getByIds = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          { id: "200", authorId: "u1", createdAt: "2026-03-22T00:00:00.000Z", text: "recent" },
          { id: "150", authorId: "u1", createdAt: "2026-02-15T00:00:00.000Z", text: "older" },
          { id: "120", authorId: "u1", createdAt: "2025-12-15T00:00:00.000Z", text: "much older" },
        ],
        includes: { users: [{ id: "u1", username: "alice", name: "Alice" }] },
      })
      .mockResolvedValueOnce({
        data: [
          { id: "110", authorId: "u1", createdAt: "2025-11-15T00:00:00.000Z", text: "newly extended" },
        ],
        includes: { users: [{ id: "u1", username: "alice", name: "Alice" }] },
      });

    mockGetClient.mockResolvedValue({
      users: { getBookmarks },
      posts: { getByIds },
    });

    const syncModule = await import("../bookmarks/sync.js");
    const storeModule = await import("../bookmarks/store.js");

    await syncModule.syncLocalBookmarks({ days: 30 });
    const extended = await syncModule.syncLocalBookmarks({ days: 120 });

    expect(extended.days).toBe(120);
    expect(getByIds).toHaveBeenCalledTimes(2);

    const secondHydrationBatch = getByIds.mock.calls[1][0] as string[];
    expect(secondHydrationBatch).toEqual(["110"]);

    const store = storeModule.BookmarkStore.open();
    try {
      expect(store.getStatus().lastSyncDays).toBe(120);
    } finally {
      store.close();
    }
  });
});
