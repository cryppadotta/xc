import type { Client } from "@xdevplatform/xdk";
import fs from "node:fs";
import {
  BookmarkStore,
  type BookmarkSnapshot,
  type HydrationLevel,
  type StoredLinkRecord,
  type StoredMediaRecord,
  type StoredPostRecord,
  type StoredReferenceRecord,
  type StoredUserRecord,
} from "./store.js";
import { getClient } from "../lib/api.js";
import { resolveAuthenticatedUserId } from "../lib/resolve.js";
import { rateLimitRetryAt } from "../lib/rate-limit.js";

const HYDRATE_TWEET_FIELDS = [
  "article",
  "attachments",
  "author_id",
  "conversation_id",
  "created_at",
  "entities",
  "lang",
  "note_tweet",
  "public_metrics",
  "referenced_tweets",
];
const EXPANSIONS = [
  "attachments.media_keys",
  "author_id",
  "referenced_tweets.id",
  "referenced_tweets.id.author_id",
];
const MEDIA_FIELDS = ["alt_text", "preview_image_url", "type", "url"];
const USER_FIELDS = ["name", "username"];

type UnknownRecord = Record<string, unknown>;

export interface LocalSyncOptions {
  accountName?: string;
  days?: number;
  maxPages?: number;
  full?: boolean;
  restart?: boolean;
  pageSize?: number;
  wait?: boolean;
}

export interface LocalSyncResult {
  pagesFetched: number;
  bookmarksSeen: number;
  postsHydrated: number;
  stopReason: "head_window" | "exhausted" | "max_pages" | "rate_limit";
  lastSyncAt: string;
  days: number;
  mode: "full" | "incremental";
  coverageComplete: boolean;
  fullScanCompletedAt: string;
  resumed: boolean;
  retryAt?: string | null;
}

interface SyncCheckpoint {
  mode: "full" | "incremental";
  pageSize: number;
  nextToken?: string;
  enumerationComplete: boolean;
  stopReason?: "head_window" | "exhausted";
  headWindow: string[];
  previousHead: string[];
  seenIds: string[];
  seenTokens: string[];
  pendingHydration: string[];
}

function acquireSyncLock(dbPath: string): () => void {
  const lock = `${dbPath}.sync.lock`;
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(fs.readFileSync(lock, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid sync lock: ${lock}`);
    try {
      process.kill(pid, 0);
    } catch (probeError) {
      if ((probeError as NodeJS.ErrnoException).code !== "ESRCH") throw probeError;
      fs.unlinkSync(lock);
      return acquireSyncLock(dbPath);
    }
    throw new Error("Another bookmark sync is running for this account.");
  }
  return () => fs.unlinkSync(lock);
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function readString(record: UnknownRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function readObject(record: UnknownRecord, ...keys: string[]): UnknownRecord {
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as UnknownRecord;
    }
  }
  return {};
}

function readArray(record: UnknownRecord, ...keys: string[]): unknown[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function normalizeJoinedText(parts: string[]): string {
  return parts.map((part) => normalizeText(part)).filter(Boolean).join("\n\n");
}

function extractMetrics(tweet: UnknownRecord): Record<string, number> {
  const metrics = readObject(tweet, "publicMetrics", "public_metrics");
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === "number") out[key] = value;
  }
  return out;
}

function extractLinks(tweet: UnknownRecord): StoredLinkRecord[] {
  const entities = readObject(tweet, "entities");
  const urls = readArray(entities, "urls");
  const links: StoredLinkRecord[] = [];

  for (const rawUrl of urls) {
    const url = asRecord(rawUrl);
    const compact = readString(url, "url");
    const expanded = readString(url, "expandedUrl", "expanded_url");
    const display = readString(url, "displayUrl", "display_url");
    if (!compact && !expanded && !display) continue;
    links.push({
      url: compact,
      expandedUrl: expanded,
      displayUrl: display,
    });
  }

  return links;
}

function extractReferences(tweet: UnknownRecord): StoredReferenceRecord[] {
  const refs = readArray(tweet, "referencedTweets", "referenced_tweets");
  const out: StoredReferenceRecord[] = [];

  for (const rawRef of refs) {
    const ref = asRecord(rawRef);
    const referencedPostId = readString(ref, "id");
    if (!referencedPostId) continue;
    out.push({
      referencedPostId,
      referenceType: readString(ref, "type"),
    });
  }

  return out;
}

function buildMediaMap(media: unknown[]): Map<string, StoredMediaRecord> {
  const out = new Map<string, StoredMediaRecord>();
  for (const rawMedia of media) {
    const item = asRecord(rawMedia);
    const mediaKey = readString(item, "mediaKey", "media_key");
    if (!mediaKey) continue;
    out.set(mediaKey, {
      mediaKey,
      type: readString(item, "type"),
      url: readString(item, "url"),
      previewImageUrl: readString(item, "previewImageUrl", "preview_image_url"),
      altText: readString(item, "altText", "alt_text"),
      rawJson: JSON.stringify(rawMedia),
    });
  }
  return out;
}

function extractMedia(tweet: UnknownRecord, mediaByKey: Map<string, StoredMediaRecord>): StoredMediaRecord[] {
  const attachments = readObject(tweet, "attachments");
  const mediaKeys = readArray(attachments, "mediaKeys", "media_keys");
  const out: StoredMediaRecord[] = [];

  for (const rawKey of mediaKeys) {
    if (typeof rawKey !== "string") continue;
    const media = mediaByKey.get(rawKey);
    if (media) out.push(media);
  }

  return out;
}

function extractUsers(rawUsers: unknown[]): StoredUserRecord[] {
  const out = new Map<string, StoredUserRecord>();
  for (const rawUser of rawUsers) {
    const user = asRecord(rawUser);
    const id = readString(user, "id");
    if (!id) continue;
    out.set(id, {
      id,
      username: readString(user, "username"),
      name: readString(user, "name"),
      rawJson: JSON.stringify(rawUser),
    });
  }
  return [...out.values()];
}

function extractTweetText(tweet: UnknownRecord): {
  text: string;
  fullText: string;
  articleTitle: string;
  articlePlainText: string;
  normalizedText: string;
} {
  const text = normalizeText(readString(tweet, "text"));
  const noteTweet = readObject(tweet, "noteTweet", "note_tweet");
  const article = readObject(tweet, "article");
  const fullText = normalizeText(pickFirst(readString(noteTweet, "text"), text));
  const articleTitle = normalizeText(readString(article, "title"));
  const articlePlainText = normalizeText(readString(article, "plainText", "plain_text"));
  const normalizedText = normalizeJoinedText([
    text,
    fullText,
    articleTitle,
    articlePlainText,
  ]);

  return {
    text,
    fullText,
    articleTitle,
    articlePlainText,
    normalizedText,
  };
}

function pickFirst(...values: string[]): string {
  for (const value of values) {
    if (value) return value;
  }
  return "";
}

function toStoredPost(
  tweet: unknown,
  mediaByKey: Map<string, StoredMediaRecord>,
  syncedAt: string,
  hydrationLevel: HydrationLevel,
): StoredPostRecord | null {
  const item = asRecord(tweet);
  const id = readString(item, "id");
  if (!id) return null;

  const text = extractTweetText(item);
  return {
    id,
    authorId: readString(item, "authorId", "author_id"),
    createdAt: readString(item, "createdAt", "created_at"),
    conversationId: readString(item, "conversationId", "conversation_id"),
    lang: readString(item, "lang"),
    text: text.text,
    fullText: text.fullText,
    articleTitle: text.articleTitle,
    articlePlainText: text.articlePlainText,
    normalizedText: text.normalizedText,
    publicMetricsJson: JSON.stringify(extractMetrics(item)),
    hydrationLevel,
    basicSyncedAt: syncedAt,
    fulltextSyncedAt: hydrationLevel === "full" ? syncedAt : "",
    metricsSyncedAt: syncedAt,
    rawJson: JSON.stringify(tweet),
    media: extractMedia(item, mediaByKey),
    links: extractLinks(item),
    references: extractReferences(item),
  };
}

function buildSnapshot(
  primaryTweets: unknown[],
  includes: UnknownRecord,
  bookmarkedIds: string[],
  syncedAt: string,
  syncRunId: string,
  hydrationLevel: HydrationLevel,
): BookmarkSnapshot {
  const includeTweets = readArray(includes, "tweets");
  const users = extractUsers(readArray(includes, "users"));
  const mediaByKey = buildMediaMap(readArray(includes, "media"));

  const postMap = new Map<string, StoredPostRecord>();
  for (const rawTweet of [...primaryTweets, ...includeTweets]) {
    const post = toStoredPost(rawTweet, mediaByKey, syncedAt, hydrationLevel);
    if (post) postMap.set(post.id, post);
  }

  return {
    posts: [...postMap.values()],
    users,
    bookmarkedIds,
    syncRunId,
    syncedAt,
  };
}

function getNextPaginationToken(result: UnknownRecord): string {
  const meta = readObject(result, "meta");
  return readString(meta, "nextToken", "next_token");
}

async function hydratePosts(
  client: Client,
  store: BookmarkStore,
  ids: string[],
  syncRunId: string,
): Promise<{ hydratedCount: number; oldestCreatedAt: string }> {
  const pending = store.getIdsNeedingHydration(ids);
  if (pending.length === 0) {
    return { hydratedCount: 0, oldestCreatedAt: "" };
  }

  let hydratedCount = 0;
  let oldestCreatedAt = "";

  for (let i = 0; i < pending.length; i += 100) {
    const batch = pending.slice(i, i + 100);
    const syncedAt = new Date().toISOString();
    const result = await client.posts.getByIds(batch, {
      tweetFields: HYDRATE_TWEET_FIELDS,
      expansions: EXPANSIONS,
      mediaFields: MEDIA_FIELDS,
      userFields: USER_FIELDS,
    });
    const primaryTweets = result.data ?? [];
    const returnedIds = primaryTweets.map((tweet) => readString(asRecord(tweet), "id")).filter(Boolean);
    const snapshot = buildSnapshot(
      primaryTweets,
      asRecord(result.includes),
      returnedIds,
      syncedAt,
      syncRunId,
      "full",
    );
    store.upsertSnapshot(snapshot);

    hydratedCount += returnedIds.length;
    if (batch.some((id) => !returnedIds.includes(id))) {
      throw new Error("X did not hydrate every requested post; incomplete work is saved for retry.");
    }
    for (const post of snapshot.posts) {
      if (!post.createdAt) continue;
      if (!oldestCreatedAt || post.createdAt < oldestCreatedAt) {
        oldestCreatedAt = post.createdAt;
      }
    }
  }

  return { hydratedCount, oldestCreatedAt };
}

export async function syncLocalBookmarks(
  opts: LocalSyncOptions = {},
): Promise<LocalSyncResult> {
  const days = opts.days ?? 30;
  const pageSize = opts.pageSize ?? 10;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 99) {
    throw new Error("Page size must be between 1 and 99 (100 can suppress X's continuation token).");
  }
  if (!Number.isInteger(days) || days < 1) throw new Error("Days must be a positive integer.");
  if (opts.maxPages !== undefined && (!Number.isInteger(opts.maxPages) || opts.maxPages < 0)) {
    throw new Error("Maximum pages must be a non-negative integer.");
  }
  const maxPages = opts.maxPages ?? 0;
  const store = BookmarkStore.open(opts.accountName);
  let unlock: (() => void) | undefined;
  let pagesFetched = 0;
  let bookmarksSeen = 0;
  let postsHydrated = 0;
  let checkpoint: SyncCheckpoint | undefined;
  let resumed = false;
  const syncRunId = `sync:${Date.now()}`;

  const saveCheckpoint = () => store.setState("local:sync_checkpoint_v2", JSON.stringify(checkpoint));
  const result = (
    stopReason: LocalSyncResult["stopReason"],
    retryAt?: number | null,
  ): LocalSyncResult => ({
    pagesFetched,
    bookmarksSeen,
    postsHydrated,
    stopReason,
    lastSyncAt: store.getLastSyncAt(),
    days,
    mode: checkpoint!.mode,
    coverageComplete: store.getStatus().coverageComplete,
    fullScanCompletedAt: store.getState("local:full_scan_completed_at_v2"),
    resumed,
    ...(retryAt === undefined ? {} : { retryAt: retryAt === null ? null : new Date(retryAt).toISOString() }),
  });

  try {
    unlock = acquireSyncLock(store.dbPath);
    const saved = store.getState("local:sync_checkpoint_v2");
    if (saved && !opts.restart) {
      checkpoint = JSON.parse(saved) as SyncCheckpoint;
      if (opts.full && checkpoint.mode !== "full") {
        throw new Error("An incremental scan is pending. Finish it or use --full --restart.");
      }
      resumed = true;
    } else {
      const full = opts.full || opts.restart || !store.getState("local:full_scan_completed_at_v2");
      checkpoint = {
        mode: full ? "full" : "incremental",
        pageSize,
        enumerationComplete: false,
        headWindow: [],
        previousHead: full ? [] : store.getHeadWindow(),
        seenIds: [],
        seenTokens: [],
        pendingHydration: [],
      };
      // Legacy last_sync_days / head_window never establish complete coverage.
      saveCheckpoint();
    }

    const client = await getClient(opts.accountName, { wait: opts.wait !== false });
    const userId = await resolveAuthenticatedUserId(opts.accountName, client);
    while (true) {
      // A crash/rate limit after enumeration cannot orphan the hydration queue.
      // Already-full posts are excluded, including batches committed before a crash.
      if (checkpoint.pendingHydration.length > 0) {
        const hydrated = await hydratePosts(client, store, checkpoint.pendingHydration, syncRunId);
        postsHydrated += hydrated.hydratedCount;
        checkpoint.pendingHydration = [];
        if (hydrated.oldestCreatedAt) {
          const oldest = store.getOldestFulltextCreatedAt();
          if (!oldest || hydrated.oldestCreatedAt < oldest) {
            store.setState("local:oldest_fulltext_created_at", hydrated.oldestCreatedAt);
          }
        }
        saveCheckpoint();
      }

      if (checkpoint.enumerationComplete) {
        const completedAt = new Date().toISOString();
        if (checkpoint.stopReason === "exhausted") {
          store.setState("local:full_scan_completed_at_v2", completedAt);
          store.setState("local:last_full_scan_bookmark_count_v2", String(checkpoint.seenIds.length));
        }
        store.setHeadWindow(checkpoint.headWindow);
        store.updateSyncMetadata(days, "");
        store.setState("local:sync_checkpoint_v2", "");
        return result(checkpoint.stopReason!);
      }
      if (maxPages > 0 && pagesFetched >= maxPages) return result("max_pages");

      const syncedAt = new Date().toISOString();
      // Enumeration requests only identity/date fields. Rich hydration is paid
      // for once, only for posts that do not already have full cache records.
      const response = await client.users.getBookmarks(userId, {
        maxResults: checkpoint.pageSize,
        paginationToken: checkpoint.nextToken,
        tweetFields: ["created_at"],
      });
      if (readArray(asRecord(response), "errors").length > 0) {
        throw new Error("X returned bookmark errors; coverage is incomplete and progress is saved.");
      }
      const primaryTweets = response.data ?? [];
      const primaryIds = primaryTweets.map((tweet) => readString(asRecord(tweet), "id")).filter(Boolean);
      const nextToken = getNextPaginationToken(asRecord(response));

      // Some X responses silently truncate the head at large page sizes.
      // Restart conservatively before trusting a single-page full scan.
      if (!checkpoint.nextToken && !nextToken && primaryIds.length > 0 && checkpoint.pageSize > 10) {
        checkpoint.pageSize = 10;
        saveCheckpoint();
        pagesFetched++;
        continue;
      }

      if (nextToken && checkpoint.seenTokens.includes(nextToken)) {
        throw new Error("X repeated a pagination token; coverage is incomplete. Retry with --restart.");
      }
      const existingLevels = store.getHydrationLevels(primaryIds);
      const snapshot = buildSnapshot(
        primaryTweets.filter((tweet) => existingLevels.get(readString(asRecord(tweet), "id")) !== "full"),
        asRecord(response.includes),
        primaryIds,
        syncedAt,
        syncRunId,
        "basic",
      );
      const seen = new Set(checkpoint.seenIds);
      const newIds = primaryIds.filter((id) => !seen.has(id));
      checkpoint.seenIds = [...new Set([...checkpoint.seenIds, ...primaryIds])];
      for (const id of newIds) {
        if (checkpoint.headWindow.length < 20) checkpoint.headWindow.push(id);
      }
      checkpoint.pendingHydration = store.getIdsNeedingHydration(primaryIds);
      checkpoint.nextToken = nextToken || undefined;
      if (nextToken) checkpoint.seenTokens.push(nextToken);

      const seenIds = new Set(checkpoint.seenIds);
      const anchors = checkpoint.previousHead.filter((id) => seenIds.has(id));
      const connected = checkpoint.mode === "incremental" && checkpoint.previousHead.length > 0 &&
        anchors.length >= Math.min(2, checkpoint.previousHead.length);
      // Never stop on publication date: bookmarks can contain old tweets at the head.
      if (!nextToken || connected) {
        checkpoint.enumerationComplete = true;
        checkpoint.stopReason = !nextToken ? "exhausted" : "head_window";
      }
      store.saveSyncPage(snapshot, checkpoint);
      pagesFetched++;
      bookmarksSeen += newIds.length;
    }
  } catch (error) {
    const retryAt = rateLimitRetryAt(error);
    if (retryAt !== undefined && checkpoint) return result("rate_limit", retryAt);
    throw error;
  } finally {
    unlock?.();
    store.close();
  }
}

export async function cacheBookmarkedPosts(
  ids: string[],
  accountName?: string,
): Promise<number> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return 0;

  const client = await getClient(accountName);
  const store = BookmarkStore.open(accountName);
  const syncRunId = `manual:${Date.now()}`;

  try {
    for (let i = 0; i < uniqueIds.length; i += 100) {
      const batch = uniqueIds.slice(i, i + 100);
      const syncedAt = new Date().toISOString();
      const result = await client.posts.getByIds(batch, {
        tweetFields: HYDRATE_TWEET_FIELDS,
        expansions: EXPANSIONS,
        mediaFields: MEDIA_FIELDS,
        userFields: USER_FIELDS,
      });
      const snapshot = buildSnapshot(
        result.data ?? [],
        asRecord(result.includes),
        batch,
        syncedAt,
        syncRunId,
        "full",
      );
      store.upsertSnapshot(snapshot);
    }

    return uniqueIds.length;
  } finally {
    store.close();
  }
}
