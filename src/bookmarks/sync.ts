import type { Client } from "@xdevplatform/xdk";
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

const DAY_MS = 86_400_000;
const BASIC_TWEET_FIELDS = [
  "author_id",
  "attachments",
  "conversation_id",
  "created_at",
  "entities",
  "lang",
  "public_metrics",
  "referenced_tweets",
];
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
}

export interface LocalSyncResult {
  pagesFetched: number;
  bookmarksSeen: number;
  postsHydrated: number;
  stopReason: "head_window" | "cutoff" | "exhausted" | "max_pages";
  lastSyncAt: string;
  days: number;
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

function createdAtWithinDays(tweet: unknown, cutoffIso: string): boolean {
  const item = asRecord(tweet);
  const createdAt = readString(item, "createdAt", "created_at");
  return !!createdAt && createdAt >= cutoffIso;
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
    const snapshot = buildSnapshot(
      primaryTweets,
      asRecord(result.includes),
      batch,
      syncedAt,
      syncRunId,
      "full",
    );
    store.upsertSnapshot(snapshot);

    hydratedCount += batch.length;
    for (const post of snapshot.posts) {
      if (!post.createdAt) continue;
      if (!oldestCreatedAt || post.createdAt < oldestCreatedAt) {
        oldestCreatedAt = post.createdAt;
      }
    }
  }

  return { hydratedCount, oldestCreatedAt };
}

function buildCutoffIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

export async function syncLocalBookmarks(
  opts: LocalSyncOptions = {},
): Promise<LocalSyncResult> {
  const days = Math.max(1, opts.days ?? 30);
  const maxPages = opts.maxPages && opts.maxPages > 0 ? opts.maxPages : 0;
  const syncRunId = `sync:${Date.now()}`;
  const store = BookmarkStore.open(opts.accountName);

  try {
    const client = await getClient(opts.accountName);
    const userId = await resolveAuthenticatedUserId(opts.accountName);
    const cutoffIso = buildCutoffIso(days);
    const previousDays = store.getLastSyncDays();
    const headWindow = store.getHeadWindow();
    const headSet = new Set(headWindow);
    const canStopOnHead = previousDays >= days && headSet.size > 0;

    let paginationToken: string | undefined;
    let pagesFetched = 0;
    let bookmarksSeen = 0;
    let stopReason: LocalSyncResult["stopReason"] = "exhausted";
    let stalePages = 0;
    const queuedHydrationIds = new Set<string>();
    const nextHeadWindow: string[] = [];

    while (true) {
      if (maxPages > 0 && pagesFetched >= maxPages) {
        stopReason = "max_pages";
        break;
      }

      const syncedAt = new Date().toISOString();
      const result = await client.users.getBookmarks(userId, {
        maxResults: 100,
        paginationToken,
        tweetFields: BASIC_TWEET_FIELDS,
        expansions: EXPANSIONS,
        mediaFields: MEDIA_FIELDS,
        userFields: USER_FIELDS,
      });

      const primaryTweets = result.data ?? [];
      const primaryIds = primaryTweets
        .map((tweet) => readString(asRecord(tweet), "id"))
        .filter(Boolean);
      const snapshot = buildSnapshot(
        primaryTweets,
        asRecord(result.includes),
        primaryIds,
        syncedAt,
        syncRunId,
        "basic",
      );
      store.upsertSnapshot(snapshot);

      for (const id of primaryIds) {
        if (nextHeadWindow.length < 20) nextHeadWindow.push(id);
      }
      for (const post of snapshot.posts) {
        queuedHydrationIds.add(post.id);
      }

      pagesFetched += 1;
      bookmarksSeen += primaryIds.length;

      if (primaryTweets.some((tweet) => headSet.has(readString(asRecord(tweet), "id")))) {
        if (canStopOnHead) {
          stopReason = "head_window";
          break;
        }
      }

      const hasRecentCreatedAt = primaryTweets.some((tweet) =>
        createdAtWithinDays(tweet, cutoffIso),
      );
      stalePages = hasRecentCreatedAt ? 0 : stalePages + 1;
      if (stalePages >= 2) {
        stopReason = "cutoff";
        break;
      }

      const nextToken = getNextPaginationToken(asRecord(result));
      if (!nextToken) {
        stopReason = "exhausted";
        break;
      }
      paginationToken = nextToken;
    }

    const hydrated = await hydratePosts(
      client,
      store,
      [...queuedHydrationIds],
      syncRunId,
    );

    store.setHeadWindow(nextHeadWindow);
    store.updateSyncMetadata(days, hydrated.oldestCreatedAt);

    return {
      pagesFetched,
      bookmarksSeen,
      postsHydrated: hydrated.hydratedCount,
      stopReason,
      lastSyncAt: store.getLastSyncAt(),
      days,
    };
  } finally {
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
