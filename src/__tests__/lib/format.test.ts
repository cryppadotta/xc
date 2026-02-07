/**
 * Tests for shared formatting utilities (buildUserMap, formatTweet, formatTweetList).
 */

import { describe, it, expect } from "vitest";
import { buildUserMap, formatTweet, formatTweetList } from "../../lib/format.js";

describe("buildUserMap", () => {
  it("builds a map from user array", () => {
    const users = [
      { id: "u1", username: "alice", name: "Alice" },
      { id: "u2", username: "bob", name: "Bob" },
    ];
    const map = buildUserMap(users as any);
    expect(map.size).toBe(2);
    expect(map.get("u1")?.username).toBe("alice");
    expect(map.get("u2")?.username).toBe("bob");
  });

  it("returns empty map for undefined input", () => {
    const map = buildUserMap(undefined);
    expect(map.size).toBe(0);
  });

  it("returns empty map for empty array", () => {
    const map = buildUserMap([]);
    expect(map.size).toBe(0);
  });

  it("skips users without id", () => {
    const users = [
      { username: "noId", name: "No ID" },
      { id: "u1", username: "valid", name: "Valid" },
    ];
    const map = buildUserMap(users as any);
    expect(map.size).toBe(1);
    expect(map.get("u1")?.username).toBe("valid");
  });
});

describe("formatTweet", () => {
  it("formats tweet with author from user map", () => {
    const tweet = {
      id: "t1",
      text: "Hello world",
      authorId: "u1",
      createdAt: "2025-01-01T00:00:00Z",
    };
    const users = new Map([
      ["u1", { id: "u1", username: "alice", name: "Alice" } as any],
    ]);

    const result = formatTweet(tweet as any, users);
    expect(result).toContain("@alice (Alice)");
    expect(result).toContain("Hello world");
    expect(result).toContain("id:t1");
  });

  it("formats tweet without author info", () => {
    const tweet = { id: "t1", text: "Hello" };
    const result = formatTweet(tweet as any);
    expect(result).toContain("Hello");
    expect(result).not.toContain("@");
  });

  it("includes engagement metrics when present", () => {
    const tweet = {
      id: "t1",
      text: "Popular post",
      publicMetrics: {
        likeCount: 10,
        retweetCount: 5,
        replyCount: 3,
        quoteCount: 1,
      },
    };
    const result = formatTweet(tweet as any);
    expect(result).toContain("10 likes");
    expect(result).toContain("5 RTs");
    expect(result).toContain("3 replies");
    expect(result).toContain("1 quotes");
  });

  it("omits zero-count metrics", () => {
    const tweet = {
      id: "t1",
      text: "No engagement",
      publicMetrics: {
        likeCount: 0,
        retweetCount: 0,
        replyCount: 0,
        quoteCount: 0,
      },
    };
    const result = formatTweet(tweet as any);
    expect(result).not.toContain("likes");
    expect(result).not.toContain("RTs");
  });

  it("handles missing text gracefully", () => {
    const tweet = { id: "t1" };
    const result = formatTweet(tweet as any);
    expect(result).toContain("id:t1");
  });

  it("indents multiline tweet text", () => {
    const tweet = { id: "t1", text: "line1\nline2\nline3" };
    const result = formatTweet(tweet as any);
    expect(result).toContain("  line1\n  line2\n  line3");
  });

  it("shows timestamp when createdAt present", () => {
    const tweet = {
      id: "t1",
      text: "timestamped",
      createdAt: "2025-06-15T12:00:00Z",
    };
    const result = formatTweet(tweet as any);
    // toLocaleString output varies by locale, just check id is present
    expect(result).toContain("id:t1");
  });

  it("formats tweet with authorId but no user map", () => {
    const tweet = { id: "t1", text: "orphan", authorId: "u999" };
    const result = formatTweet(tweet as any);
    // No author line since user not in map
    expect(result).not.toContain("@");
    expect(result).toContain("orphan");
  });
});

describe("formatTweetList", () => {
  it("joins multiple tweets with blank lines", () => {
    const tweets = [
      { id: "t1", text: "First" },
      { id: "t2", text: "Second" },
    ];
    const result = formatTweetList(tweets as any);
    expect(result).toContain("First");
    expect(result).toContain("Second");
    expect(result).toContain("\n\n");
  });

  it("returns empty string for empty list", () => {
    const result = formatTweetList([]);
    expect(result).toBe("");
  });

  it("returns single tweet without trailing separator", () => {
    const tweets = [{ id: "t1", text: "Only one" }];
    const result = formatTweetList(tweets as any);
    expect(result).toContain("Only one");
    expect(result).not.toContain("\n\n");
  });
});
