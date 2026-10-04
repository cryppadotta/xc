import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetClient, mockResolveAuthenticatedUserId } = vi.hoisted(() => ({
  mockGetClient: vi.fn(), mockResolveAuthenticatedUserId: vi.fn(),
}));
vi.mock("../lib/api.js", () => ({ getClient: mockGetClient }));
vi.mock("../lib/resolve.js", () => ({ resolveAuthenticatedUserId: mockResolveAuthenticatedUserId }));
let tmpDir: string;
let originalConfigDir: string | undefined;
let getBookmarks: ReturnType<typeof vi.fn>;
let getByIds: ReturnType<typeof vi.fn>;
const tweet = (id: string, date = "2020-01-01T00:00:00.000Z") => ({
  id, authorId: "u1", createdAt: date, text: `short ${id}`,
});
const page = (ids: string[], token?: string) => ({
  data: ids.map((id) => tweet(id)), meta: token ? { nextToken: token } : {},
});
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xc-bookmark-sync-"));
  originalConfigDir = process.env.XC_CONFIG_DIR;
  process.env.XC_CONFIG_DIR = tmpDir;
  vi.resetModules();
  mockGetClient.mockReset();
  mockResolveAuthenticatedUserId.mockResolvedValue("me");
  getBookmarks = vi.fn();
  getByIds = vi.fn(async (ids: string[]) => ({
    data: ids.map((id) => ({ ...tweet(id), noteTweet: { text: `complete ${id}` } })),
  }));
  mockGetClient.mockResolvedValue({ users: { getBookmarks }, posts: { getByIds } });
});
afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.XC_CONFIG_DIR;
  else process.env.XC_CONFIG_DIR = originalConfigDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function modules() {
  return { ...(await import("../bookmarks/sync.js")), ...(await import("../bookmarks/store.js")) };
}

describe("resumable bookmark coverage", () => {
  it("follows every page despite old publication dates, then syncs only the head", async () => {
    getBookmarks.mockResolvedValueOnce(page(["100", "99"], "p2"))
      .mockResolvedValueOnce(page(["90"], "p3")).mockResolvedValueOnce(page(["80"]));
    const { syncLocalBookmarks, BookmarkStore } = await modules();
    const full = await syncLocalBookmarks({ days: 1 });
    expect(full).toMatchObject({ pagesFetched: 3, postsHydrated: 4, stopReason: "exhausted", coverageComplete: true, mode: "full" });
    expect(getBookmarks.mock.calls[0][1].maxResults).toBe(10);
    expect(getBookmarks.mock.calls[1][1].paginationToken).toBe("p2");

    getBookmarks.mockResolvedValueOnce(page(["101", "100", "99"], "ignored"));
    const incremental = await syncLocalBookmarks({ days: 1 });
    expect(incremental).toMatchObject({ pagesFetched: 1, postsHydrated: 1, stopReason: "head_window", coverageComplete: true });
    expect(getByIds.mock.calls.at(-1)![0]).toEqual(["101"]);
    const store = BookmarkStore.open();
    try {
      expect(store.getStatus().bookmarkCount).toBe(5);
      expect(store.getBookmark("100")?.fullText).toBe("complete 100");
    } finally { store.close(); }
  });

  it("does not trust legacy completed/head metadata", async () => {
    const { syncLocalBookmarks, BookmarkStore } = await modules();
    const store = BookmarkStore.open();
    store.setHeadWindow(["100"]); store.updateSyncMetadata(10000, ""); store.close();
    getBookmarks.mockResolvedValueOnce(page(["100"], "p2")).mockResolvedValueOnce(page(["90"]));
    expect(await syncLocalBookmarks()).toMatchObject({ pagesFetched: 2, mode: "full", coverageComplete: true });
  });

  it("persists max-page progress without committing a partial head as complete", async () => {
    const { syncLocalBookmarks, BookmarkStore } = await modules();
    getBookmarks.mockResolvedValueOnce(page(["100"], "p2")).mockResolvedValueOnce(page(["90"]));
    const partial = await syncLocalBookmarks({ maxPages: 1 });
    expect(partial).toMatchObject({ stopReason: "max_pages", coverageComplete: false });
    const store = BookmarkStore.open();
    expect(store.getHeadWindow()).toEqual([]);
    expect(store.getStatus().syncPending).toBe(true); store.close();
    const resumed = await syncLocalBookmarks();
    expect(resumed).toMatchObject({ resumed: true, pagesFetched: 1, postsHydrated: 1, coverageComplete: true });
    expect(getBookmarks.mock.calls[1][1].paginationToken).toBe("p2");
    expect(getByIds.mock.calls).toHaveLength(2);
  });

  it("returns a durable continuation on rate limit and resumes after reset", async () => {
    const { syncLocalBookmarks } = await modules();
    const { RateLimitError } = await import("../lib/rate-limit.js");
    const reset = Date.now() + 900000;
    getBookmarks.mockResolvedValueOnce(page(["100"], "p2"))
      .mockRejectedValueOnce(new RateLimitError(reset, "bookmarks"))
      .mockResolvedValueOnce(page(["90"]));
    const partial = await syncLocalBookmarks({ wait: false });
    expect(partial).toMatchObject({ stopReason: "rate_limit", retryAt: new Date(reset).toISOString(), coverageComplete: false });
    expect(mockGetClient).toHaveBeenCalledWith(undefined, { wait: false });
    expect(await syncLocalBookmarks()).toMatchObject({ resumed: true, coverageComplete: true });
    expect(getBookmarks.mock.calls[2][1].paginationToken).toBe("p2");
  });

  it("retries saved hydration before enumerating the next page", async () => {
    const { syncLocalBookmarks } = await modules();
    const { RateLimitError } = await import("../lib/rate-limit.js");
    getBookmarks.mockResolvedValueOnce(page(["100"], "p2")).mockResolvedValueOnce(page(["90"]));
    getByIds.mockRejectedValueOnce(new RateLimitError(Date.now() + 900000, "tweets"));
    expect(await syncLocalBookmarks({ wait: false })).toMatchObject({ stopReason: "rate_limit", coverageComplete: false });
    expect(getBookmarks).toHaveBeenCalledTimes(1);
    expect(await syncLocalBookmarks()).toMatchObject({ resumed: true, postsHydrated: 2, coverageComplete: true });
    expect(getByIds.mock.calls[1][0]).toEqual(["100"]);
  });

  it("does not rehydrate committed batches after an interruption", async () => {
    const { syncLocalBookmarks } = await modules();
    getBookmarks.mockResolvedValueOnce(page(["100", "99"]));
    getByIds.mockResolvedValueOnce({ data: [tweet("100")] });
    await expect(syncLocalBookmarks()).rejects.toThrow("did not hydrate every");
    const resumed = await syncLocalBookmarks();
    expect(resumed).toMatchObject({ resumed: true, pagesFetched: 0, postsHydrated: 1, coverageComplete: true });
    expect(getByIds.mock.calls[1][0]).toEqual(["99"]);
  });

  it("only reconnects incremental scans after enough confirmed anchors", async () => {
    const { syncLocalBookmarks } = await modules();
    getBookmarks.mockResolvedValueOnce(page(["100", "99"]));
    await syncLocalBookmarks();
    getBookmarks.mockResolvedValueOnce(page(["101", "100"], "p2"))
      .mockResolvedValueOnce(page(["98", "99"], "p3"));
    expect(await syncLocalBookmarks()).toMatchObject({ pagesFetched: 2, postsHydrated: 2, stopReason: "head_window" });
  });

  it("resumes an interrupted incremental scan using its original anchor", async () => {
    const { syncLocalBookmarks } = await modules();
    getBookmarks.mockResolvedValueOnce(page(["100", "99"]));
    await syncLocalBookmarks();
    getBookmarks.mockResolvedValueOnce(page(["102", "101"], "p2"));
    expect(await syncLocalBookmarks({ maxPages: 1 })).toMatchObject({ coverageComplete: false });
    getBookmarks.mockResolvedValueOnce(page(["100", "99"], "p3"));
    expect(await syncLocalBookmarks()).toMatchObject({ resumed: true, stopReason: "head_window", coverageComplete: true });
  });

  it("explicit full verification skips hydration of already-full posts", async () => {
    const { syncLocalBookmarks } = await modules();
    getBookmarks.mockResolvedValueOnce(page(["100", "99"])); await syncLocalBookmarks();
    getBookmarks.mockResolvedValueOnce(page(["100", "99"], "p2")).mockResolvedValueOnce(page(["80"]));
    expect(await syncLocalBookmarks({ full: true })).toMatchObject({ mode: "full", pagesFetched: 2, postsHydrated: 1, coverageComplete: true });
    expect(getByIds.mock.calls.at(-1)![0]).toEqual(["80"]);
  });

  it("falls back to proven small pages before trusting a truncated large head", async () => {
    const { syncLocalBookmarks } = await modules();
    getBookmarks.mockResolvedValueOnce(page(["100", "99"]))
      .mockResolvedValueOnce(page(["100", "99"], "p2")).mockResolvedValueOnce(page(["80"]));
    expect(await syncLocalBookmarks({ pageSize: 50 })).toMatchObject({ pagesFetched: 3, bookmarksSeen: 3, coverageComplete: true });
    expect(getBookmarks.mock.calls.map((c) => c[1].maxResults)).toEqual([50, 10, 10]);
  });

  it("does not claim success on repeated cursors and allows a cached restart", async () => {
    const { syncLocalBookmarks } = await modules();
    getBookmarks.mockResolvedValueOnce(page(["100"], "same")).mockResolvedValueOnce(page(["90"], "same"));
    await expect(syncLocalBookmarks()).rejects.toThrow("repeated a pagination token");
    getBookmarks.mockResolvedValueOnce(page(["100", "90"]));
    expect(await syncLocalBookmarks({ restart: true })).toMatchObject({ coverageComplete: true, postsHydrated: 1 });
  });

  it("rejects concurrent syncs without consuming paid API calls", async () => {
    const { syncLocalBookmarks, BookmarkStore } = await modules();
    const store = BookmarkStore.open(); const lock = `${store.dbPath}.sync.lock`; store.close();
    fs.writeFileSync(lock, String(process.pid));
    await expect(syncLocalBookmarks()).rejects.toThrow("Another bookmark sync");
    expect(getBookmarks).not.toHaveBeenCalled();
    expect(fs.existsSync(lock)).toBe(true);
  });

  it("marks empty API results as complete and rejects the broken 100-page size", async () => {
    const { syncLocalBookmarks } = await modules();
    getBookmarks.mockResolvedValueOnce(page([]));
    expect(await syncLocalBookmarks()).toMatchObject({ stopReason: "exhausted", coverageComplete: true, postsHydrated: 0 });
    await expect(syncLocalBookmarks({ pageSize: 100 })).rejects.toThrow("between 1 and 99");
  });

  it("does not mistake an API error response for an empty complete archive", async () => {
    const { syncLocalBookmarks, BookmarkStore } = await modules();
    getBookmarks.mockResolvedValueOnce({ data: [], errors: [{ title: "Authorization Error" }] });
    await expect(syncLocalBookmarks()).rejects.toThrow("bookmark errors");
    const store = BookmarkStore.open();
    expect(store.getStatus()).toMatchObject({ coverageComplete: false, syncPending: true });
    store.close();
  });
});
