/**
 * API request cost tracking.
 * Logs every API call to ~/.xc/usage.jsonl with timestamp,
 * endpoint, HTTP method, and estimated dollar cost.
 */

import fs from "node:fs";
import path from "node:path";
import { getConfigDir, ensureConfigDir } from "./config.js";

/** Single usage log entry written to usage.jsonl. */
export interface UsageEntry {
  timestamp: string;
  endpoint: string;
  method: string;
  estimatedCost: number;
}

/**
 * Estimated cost per SDK endpoint (in dollars).
 * These are rough estimates based on X API pricing tiers.
 */
const COST_MAP: Record<string, number> = {
  "posts.searchRecent": 0.01,
  "posts.searchAll": 0.02,
  "posts.create": 0.01,
  "posts.delete": 0.005,
  "users.getMe": 0.005,
  "users.getByUsername": 0.005,
  "users.getPosts": 0.005,
  "users.getTimeline": 0.005,
  "users.likePost": 0.005,
  "users.unlikePost": 0.005,
  "users.getBookmarks": 0.005,
  "users.createBookmark": 0.005,
  "users.deleteBookmark": 0.005,
  "users.getFollowers": 0.005,
  "users.getFollowing": 0.005,
  "users.followUser": 0.005,
  "users.unfollowUser": 0.005,
  "users.getOwnedLists": 0.005,
  "lists.getPosts": 0.005,
  "directMessages.createByParticipantId": 0.01,
  "directMessages.getEvents": 0.005,
  "directMessages.getEventsByParticipantId": 0.005,
  "media.upload": 0.01,
  "media.initializeUpload": 0.005,
  "media.appendUpload": 0.0,
  "media.finalizeUpload": 0.005,
  "media.getUploadStatus": 0.0,
  "usage.get": 0.0,
  "stream.getRules": 0.0,
  "stream.updateRules": 0.005,
  "stream.posts": 0.0,
  // Reposts
  "users.repostPost": 0.005,
  "users.unrepostPost": 0.005,
  // Mentions
  "users.getMentions": 0.005,
  // Engagement lookups
  "posts.getQuoteTweets": 0.005,
  "posts.getLikingUsers": 0.005,
  "posts.getRetweetedBy": 0.005,
  "users.getLikedPosts": 0.005,
  // Hide replies
  "posts.hideReply": 0.005,
  "posts.unhideReply": 0.005,
  // Mute
  "users.muteUser": 0.005,
  "users.unmuteUser": 0.005,
  "users.getMuting": 0.005,
  // Block
  "users.blockUser": 0.005,
  "users.unblockUser": 0.005,
  "users.getBlocking": 0.005,
  // User search
  "users.search": 0.01,
  // List management
  "lists.create": 0.005,
  "lists.update": 0.005,
  "lists.delete": 0.005,
  "lists.getMembers": 0.005,
  "lists.addMember": 0.005,
  "lists.removeMember": 0.005,
  "users.followList": 0.005,
  "users.unfollowList": 0.005,
  "users.pinList": 0.005,
  "users.unpinList": 0.005,
  // Trends
  "trends.getPersonalized": 0.005,
  "trends.getByWoeid": 0.005,
};

const DEFAULT_COST = 0.005;

/** In-memory log of API calls made during this process. */
const sessionCalls: { endpoint: string; cost: number }[] = [];

/** Inferred HTTP method per endpoint. Defaults to GET. */
const METHOD_MAP: Record<string, string> = {
  "posts.create": "POST",
  "posts.delete": "DELETE",
  "users.likePost": "POST",
  "users.unlikePost": "DELETE",
  "users.createBookmark": "POST",
  "users.deleteBookmark": "DELETE",
  "users.followUser": "POST",
  "users.unfollowUser": "DELETE",
  "directMessages.createByParticipantId": "POST",
  "media.upload": "POST",
  "media.initializeUpload": "POST",
  "media.appendUpload": "POST",
  "media.finalizeUpload": "POST",
  "stream.updateRules": "POST",
  "users.repostPost": "POST",
  "users.unrepostPost": "DELETE",
  "posts.hideReply": "PUT",
  "posts.unhideReply": "PUT",
  "users.muteUser": "POST",
  "users.unmuteUser": "DELETE",
  "users.blockUser": "POST",
  "users.unblockUser": "DELETE",
  "lists.create": "POST",
  "lists.update": "PUT",
  "lists.delete": "DELETE",
  "lists.addMember": "POST",
  "lists.removeMember": "DELETE",
  "users.followList": "POST",
  "users.unfollowList": "DELETE",
  "users.pinList": "POST",
  "users.unpinList": "DELETE",
};

/** Get estimated dollar cost for an endpoint. */
export function estimateCost(endpoint: string): number {
  return COST_MAP[endpoint] ?? DEFAULT_COST;
}

/** Infer the HTTP method for an endpoint. */
export function inferMethod(endpoint: string): string {
  return METHOD_MAP[endpoint] ?? "GET";
}

/** Path to the usage log file. */
export function getUsageLogPath(): string {
  return path.join(getConfigDir(), "usage.jsonl");
}

/** Append a usage entry to the JSONL log and track in-memory. */
export function logApiCall(endpoint: string): void {
  ensureConfigDir();
  const cost = estimateCost(endpoint);
  sessionCalls.push({ endpoint, cost });
  const entry: UsageEntry = {
    timestamp: new Date().toISOString(),
    endpoint,
    method: inferMethod(endpoint),
    estimatedCost: cost,
  };
  fs.appendFileSync(getUsageLogPath(), JSON.stringify(entry) + "\n");
}

/** Get cost summary for API calls made in this session. */
export function getSessionCost(): { endpoints: string[]; total: number } {
  const total = sessionCalls.reduce((sum, c) => sum + c.cost, 0);
  return { endpoints: sessionCalls.map((c) => c.endpoint), total };
}

/** Print data as JSON with session cost included in the object. */
export function outputJson(data: unknown): void {
  const cost = getSessionCost();
  const wrapped =
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? { ...data, _cost: cost }
      : { data, _cost: cost };
  console.log(JSON.stringify(wrapped, null, 2));
}

/** Read all usage entries from the log file. */
export function loadUsageLog(): UsageEntry[] {
  const logPath = getUsageLogPath();
  if (!fs.existsSync(logPath)) return [];

  const raw = fs.readFileSync(logPath, "utf-8").trim();
  if (!raw) return [];

  const entries: UsageEntry[] = [];
  for (const line of raw.split("\n")) {
    try {
      entries.push(JSON.parse(line) as UsageEntry);
    } catch {
      // Skip malformed lines
    }
  }
  return entries;
}

/** Sum estimated costs for entries within a time window (ms from now). */
export function computeSpend(entries: UsageEntry[], windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  let total = 0;
  for (const entry of entries) {
    if (new Date(entry.timestamp).getTime() >= cutoff) {
      total += entry.estimatedCost;
    }
  }
  return total;
}

/** Sum estimated costs for entries from midnight today. */
export function computeTodaySpend(entries: UsageEntry[]): number {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const cutoff = midnight.getTime();

  let total = 0;
  for (const entry of entries) {
    if (new Date(entry.timestamp).getTime() >= cutoff) {
      total += entry.estimatedCost;
    }
  }
  return total;
}

/** Time window constants (milliseconds). */
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const WEEK = 7 * DAY;
export const MONTH = 30 * DAY;

/** Format a dollar amount as $X.XX. */
function fmt(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Build the compact cost footer line.
 * Returns empty string if no usage has been recorded.
 */
export function formatCostFooter(): string {
  const entries = loadUsageLog();
  if (entries.length === 0) return "";

  const h1 = computeSpend(entries, HOUR);
  const h24 = computeSpend(entries, DAY);
  const d7 = computeSpend(entries, WEEK);
  const d30 = computeSpend(entries, MONTH);

  return `Cost: ${fmt(h1)} (1h) \u00b7 ${fmt(h24)} (24h) \u00b7 ${fmt(d7)} (7d) \u00b7 ${fmt(d30)} (30d)`;
}
