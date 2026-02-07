/** Shared types and formatting utilities for tweet/user display. */

export interface TweetData {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
}

export interface UserData {
  id: string;
  name: string;
  username: string;
  description?: string;
  created_at?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
  };
}

/** Build a lookup map from an API includes.users array. */
export function buildUserMap(users?: UserData[]): Map<string, UserData> {
  const map = new Map<string, UserData>();
  if (users) {
    for (const user of users) {
      map.set(user.id, user);
    }
  }
  return map;
}

/** Format a single tweet for human-readable terminal output. */
export function formatTweet(
  tweet: TweetData,
  usersById?: Map<string, UserData>,
): string {
  const lines: string[] = [];

  // Author line
  const author = tweet.author_id ? usersById?.get(tweet.author_id) : undefined;
  if (author) {
    lines.push(`@${author.username} (${author.name})`);
  }

  // Tweet text (indent continuation lines)
  lines.push(`  ${tweet.text.replace(/\n/g, "\n  ")}`);

  // Engagement metrics
  const m = tweet.public_metrics;
  if (m) {
    const parts: string[] = [];
    if (m.like_count) parts.push(`${m.like_count} likes`);
    if (m.retweet_count) parts.push(`${m.retweet_count} RTs`);
    if (m.reply_count) parts.push(`${m.reply_count} replies`);
    if (m.quote_count) parts.push(`${m.quote_count} quotes`);
    if (parts.length > 0) {
      lines.push(`  ${parts.join(" · ")}`);
    }
  }

  // Timestamp and post ID
  const meta: string[] = [];
  if (tweet.created_at) {
    meta.push(new Date(tweet.created_at).toLocaleString());
  }
  meta.push(`id:${tweet.id}`);
  lines.push(`  ${meta.join(" · ")}`);

  return lines.join("\n");
}

/** Format a list of tweets with separator lines between them. */
export function formatTweetList(
  tweets: TweetData[],
  usersById?: Map<string, UserData>,
): string {
  return tweets.map((t) => formatTweet(t, usersById)).join("\n\n");
}
