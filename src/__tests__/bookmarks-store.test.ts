/**
 * Tests for the local bookmark SQLite store.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StoreModule = typeof import("../bookmarks/store.js");

let tmpDir: string;
let originalConfigDir: string | undefined;
let storeModule: StoreModule;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xc-bookmark-store-"));
  originalConfigDir = process.env.XC_CONFIG_DIR;
  process.env.XC_CONFIG_DIR = tmpDir;
  vi.resetModules();
  storeModule = await import("../bookmarks/store.js");
});

afterEach(() => {
  if (originalConfigDir !== undefined) {
    process.env.XC_CONFIG_DIR = originalConfigDir;
  } else {
    delete process.env.XC_CONFIG_DIR;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("BookmarkStore", () => {
  it("stores, searches, and shows cached bookmarks", () => {
    const store = storeModule.BookmarkStore.open();
    try {
      store.upsertSnapshot({
        syncRunId: "test-run",
        syncedAt: "2026-03-23T00:00:00.000Z",
        bookmarkedIds: ["main"],
        users: [
          {
            id: "u1",
            username: "alice",
            name: "Alice",
            rawJson: "{}",
          },
          {
            id: "u2",
            username: "bob",
            name: "Bob",
            rawJson: "{}",
          },
        ],
        posts: [
          {
            id: "main",
            authorId: "u1",
            createdAt: "2026-03-20T00:00:00.000Z",
            conversationId: "main",
            lang: "en",
            text: "RT @bob",
            fullText: "RT @bob",
            articleTitle: "",
            articlePlainText: "",
            normalizedText: "RT @bob",
            publicMetricsJson: JSON.stringify({ likeCount: 10, retweetCount: 5 }),
            hydrationLevel: "full",
            basicSyncedAt: "2026-03-23T00:00:00.000Z",
            fulltextSyncedAt: "2026-03-23T00:00:00.000Z",
            metricsSyncedAt: "2026-03-23T00:00:00.000Z",
            rawJson: "{}",
            media: [],
            links: [{ url: "https://t.co/x", expandedUrl: "https://example.com/post", displayUrl: "example.com/post" }],
            references: [{ referencedPostId: "source", referenceType: "retweeted" }],
          },
          {
            id: "source",
            authorId: "u2",
            createdAt: "2026-03-19T00:00:00.000Z",
            conversationId: "source",
            lang: "en",
            text: "source short text",
            fullText: "source full text from referenced post",
            articleTitle: "",
            articlePlainText: "",
            normalizedText: "source full text from referenced post",
            publicMetricsJson: "{}",
            hydrationLevel: "full",
            basicSyncedAt: "2026-03-23T00:00:00.000Z",
            fulltextSyncedAt: "2026-03-23T00:00:00.000Z",
            metricsSyncedAt: "2026-03-23T00:00:00.000Z",
            rawJson: "{}",
            media: [],
            links: [],
            references: [],
          },
        ],
      });

      store.updateSyncMetadata(30, "2026-03-19T00:00:00.000Z");
      store.setHeadWindow(["main"]);

      const status = store.getStatus();
      expect(status.bookmarkCount).toBe(1);
      expect(status.fulltextCount).toBe(2);
      expect(status.hasCompletedSync).toBe(true);

      const listed = store.listBookmarks({ limit: 10 });
      expect(listed).toHaveLength(1);
      expect(listed[0].username).toBe("alice");

      const searched = store.searchBookmarks({ query: "referenced", limit: 10 });
      expect(searched).toHaveLength(1);
      expect(searched[0].id).toBe("main");

      const detail = store.getBookmark("main");
      expect(detail?.references).toHaveLength(1);
      expect(detail?.references[0].fullText).toContain("source full text");

      const query = store.runReadOnlyQuery("select count(*) as count from bookmark_posts");
      expect(query.columns).toEqual(["count"]);
      expect(query.rows[0][0]).toBe("1");
      expect(() => store.runReadOnlyQuery("insert into bookmark_posts(post_id, first_seen_at, last_seen_at, source_sync_run_id) values ('x','a','b','c')")).toThrow(
        /read-only/,
      );
    } finally {
      store.close();
    }
  });
});
