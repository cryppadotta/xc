/**
 * Bookmarks commands: remote listing, local cache sync/search, add, and remove.
 */

import { Command } from "commander";
import { formatBookmarkDetail, formatBookmarkList } from "../bookmarks/format.js";
import { BookmarkStore } from "../bookmarks/store.js";
import { cacheBookmarkedPosts, syncLocalBookmarks } from "../bookmarks/sync.js";
import { getClient } from "../lib/api.js";
import { outputJson } from "../lib/cost.js";
import { buildUserMap, formatTweetList } from "../lib/format.js";
import { parsePostId } from "../lib/post-id.js";
import { resolveAuthenticatedUserId } from "../lib/resolve.js";

const REMOTE_TWEET_FIELDS = ["created_at", "public_metrics", "author_id"];
const REMOTE_EXPANSIONS = ["author_id"];
const REMOTE_USER_FIELDS = ["name", "username"];

function parseLimit(raw: string | undefined, fallback: number): number {
  const parsed = raw ? parseInt(raw, 10) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid limit: ${raw}`);
  }
  return parsed;
}

function parseDays(days?: string): number {
  if (!days) return 0;
  const parsed = parseInt(days, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid days value: ${days}`);
  }
  return parsed;
}

function parseOptionalDate(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid RFC3339 date: ${value}`);
  }
  return parsed.toISOString();
}

function resolveDateFilters(opts: {
  days?: string;
  since?: string;
  before?: string;
}): { since: string; before: string } {
  if (opts.days && opts.since) {
    throw new Error("Use either --days or --since");
  }

  const before = parseOptionalDate(opts.before);
  if (opts.days) {
    const days = parseDays(opts.days);
    return {
      since: new Date(Date.now() - days * 86_400_000).toISOString(),
      before,
    };
  }

  return {
    since: parseOptionalDate(opts.since),
    before,
  };
}

function printSqlRows(columns: string[], rows: string[][]): void {
  console.log(columns.join("\t"));
  for (const row of rows) {
    console.log(row.join("\t"));
  }
}

function printCacheHeader(store: BookmarkStore): void {
  const status = store.getStatus();
  if (status.hasCompletedSync) {
    console.log(`Local bookmark cache synced ${new Date(status.lastSyncAt).toLocaleString()} (${status.lastSyncDays}d window)\n`);
    return;
  }

  if (status.bookmarkCount > 0) {
    console.log("Local bookmark cache has data but no completed sync yet.\n");
    return;
  }

  console.log("No local bookmark cache found. Run: xc bookmarks local sync\n");
}

function withLocalStore<T>(accountName: string | undefined, fn: (store: BookmarkStore) => T): T {
  const store = BookmarkStore.open(accountName);
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

export function registerBookmarksCommand(program: Command): void {
  const bookmarks = program
    .command("bookmarks")
    .description("Remote and local bookmark tools");

  bookmarks
    .command("remote")
    .description("List your bookmarks from X")
    .option("-n, --limit <n>", "Max results (1-100)", "20")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (opts) => {
      try {
        const userId = await resolveAuthenticatedUserId(opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.getBookmarks(userId, {
          tweetFields: REMOTE_TWEET_FIELDS,
          expansions: REMOTE_EXPANSIONS,
          userFields: REMOTE_USER_FIELDS,
          maxResults: parseLimit(opts.limit, 20),
        });

        if (opts.json) {
          outputJson(result);
          return;
        }

        const tweets = result.data ?? [];
        if (tweets.length === 0) {
          console.log("No bookmarks.");
          return;
        }

        const usersById = buildUserMap(result.includes?.users);
        console.log("Bookmarks:\n");
        console.log(formatTweetList(tweets, usersById));
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  const local = bookmarks
    .command("local")
    .description("Search and inspect the local bookmark cache");

  local
    .command("sync")
    .description("Sync bookmarks into the local SQLite cache")
    .option("--days <n>", "Target post coverage window in days", "30")
    .option("--max-pages <n>", "Maximum pages to fetch")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (opts) => {
      try {
        const result = await syncLocalBookmarks({
          accountName: opts.account,
          days: parseDays(opts.days) || 30,
          maxPages: opts.maxPages ? parseLimit(opts.maxPages, 1) : 0,
        });

        if (opts.json) {
          outputJson(result);
          return;
        }

        console.log(
          `Synced ${result.bookmarksSeen} bookmarks in ${result.pagesFetched} page${result.pagesFetched === 1 ? "" : "s"} (${result.days}d target window).`,
        );
        console.log(`Hydrated ${result.postsHydrated} post${result.postsHydrated === 1 ? "" : "s"}.`);
        console.log(`Stop reason: ${result.stopReason}`);
        console.log(`Last sync: ${new Date(result.lastSyncAt).toLocaleString()}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  local
    .command("status")
    .description("Show local bookmark cache status")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action((opts) => {
      try {
        withLocalStore(opts.account, (store) => {
          const status = store.getStatus();

          if (opts.json) {
            outputJson(status);
            return;
          }

          console.log(`db=${status.dbPath}`);
          console.log(`bookmarks=${status.bookmarkCount}`);
          console.log(`posts=${status.postCount}`);
          console.log(`users=${status.userCount}`);
          console.log(`media=${status.mediaCount}`);
          console.log(`fulltext=${status.fulltextCount}`);
          console.log(`last_sync=${status.lastSyncAt || "never"}`);
          console.log(`sync_window_days=${status.lastSyncDays || 0}`);
          console.log(`oldest_fulltext_created_at=${status.oldestFulltextCreatedAt || ""}`);
          console.log(`head_window=${status.headWindow.join(",")}`);
        });
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  local
    .command("list")
    .description("List cached bookmarks")
    .option("--author <query>", "Filter by author username/name")
    .option("--days <n>", "Only show posts created in the last N days")
    .option("--since <rfc3339>", "Only show posts created at or after this time")
    .option("--before <rfc3339>", "Only show posts created before this time")
    .option("--has-link", "Only include bookmarks with links")
    .option("--has-media", "Only include bookmarks with media")
    .option("-n, --limit <n>", "Max results", "20")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action((opts) => {
      try {
        const { since, before } = resolveDateFilters(opts);
        withLocalStore(opts.account, (store) => {
          const rows = store.listBookmarks({
            author: opts.author,
            since,
            before,
            hasLink: !!opts.hasLink,
            hasMedia: !!opts.hasMedia,
            limit: parseLimit(opts.limit, 20),
          });

          if (opts.json) {
            outputJson(rows);
            return;
          }

          printCacheHeader(store);
          if (rows.length === 0) {
            console.log("No cached bookmarks found.");
            return;
          }
          console.log(formatBookmarkList(rows));
        });
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  local
    .command("search <query>")
    .description("Search cached bookmarks")
    .option("--author <query>", "Filter by author username/name")
    .option("--days <n>", "Only include posts created in the last N days")
    .option("--since <rfc3339>", "Only include posts created at or after this time")
    .option("--before <rfc3339>", "Only include posts created before this time")
    .option("--has-link", "Only include bookmarks with links")
    .option("--has-media", "Only include bookmarks with media")
    .option("-n, --limit <n>", "Max results", "20")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action((query: string, opts) => {
      try {
        const { since, before } = resolveDateFilters(opts);
        withLocalStore(opts.account, (store) => {
          const rows = store.searchBookmarks({
            query,
            author: opts.author,
            since,
            before,
            hasLink: !!opts.hasLink,
            hasMedia: !!opts.hasMedia,
            limit: parseLimit(opts.limit, 20),
          });

          if (opts.json) {
            outputJson(rows);
            return;
          }

          printCacheHeader(store);
          if (rows.length === 0) {
            console.log("No cached bookmarks found.");
            return;
          }
          console.log(formatBookmarkList(rows));
        });
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  local
    .command("show <post-id-or-url>")
    .description("Show one cached bookmark")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action((postIdOrUrl: string, opts) => {
      try {
        withLocalStore(opts.account, (store) => {
          const row = store.getBookmark(postIdOrUrl);
          if (!row) {
            if (!opts.json) printCacheHeader(store);
            console.log("Cached bookmark not found.");
            return;
          }

          if (opts.json) {
            outputJson(row);
            return;
          }

          printCacheHeader(store);
          console.log(formatBookmarkDetail(row));
        });
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  local
    .command("sql <query...>")
    .description("Run read-only SQL against the local bookmark cache")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action((queryParts: string[], opts) => {
      try {
        const query = queryParts.join(" ").trim();
        withLocalStore(opts.account, (store) => {
          const result = store.runReadOnlyQuery(query);
          if (opts.json) {
            outputJson(result);
            return;
          }
          printCacheHeader(store);
          printSqlRows(result.columns, result.rows);
        });
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

export function registerBookmarkCommand(program: Command): void {
  program
    .command("bookmark <post-id-or-url>")
    .description("Bookmark a post")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (postIdOrUrl: string, opts) => {
      try {
        const postId = parsePostId(postIdOrUrl);
        const userId = await resolveAuthenticatedUserId(opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.createBookmark(userId, {
          tweetId: postId,
        });

        try {
          await cacheBookmarkedPosts([postId], opts.account);
        } catch (cacheErr) {
          console.error(
            `Warning: bookmark succeeded but local cache update failed: ${cacheErr instanceof Error ? cacheErr.message : cacheErr}`,
          );
        }

        if (opts.json) {
          outputJson(result);
          return;
        }

        console.log(`Bookmarked post ${postId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

export function registerUnbookmarkCommand(program: Command): void {
  program
    .command("unbookmark <post-id-or-url>")
    .description("Remove a post from bookmarks")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (postIdOrUrl: string, opts) => {
      try {
        const postId = parsePostId(postIdOrUrl);
        const userId = await resolveAuthenticatedUserId(opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.deleteBookmark(userId, postId);

        if (opts.json) {
          outputJson(result);
          return;
        }

        console.log(`Unbookmarked post ${postId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
