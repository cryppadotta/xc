/**
 * Bookmarks commands: list, add, and remove bookmarks.
 *
 * Usage:
 *   xc bookmarks              — list bookmarked posts
 *   xc bookmark <post-id>     — add a post to bookmarks
 *   xc unbookmark <post-id>   — remove from bookmarks
 */

import { Command } from "commander";
import { getClient } from "../lib/api.js";
import { resolveAuthenticatedUserId } from "../lib/resolve.js";
import { buildUserMap, formatTweetList } from "../lib/format.js";

const TWEET_FIELDS = ["created_at", "public_metrics", "author_id"];
const EXPANSIONS = ["author_id"];
const USER_FIELDS = ["name", "username"];

export function registerBookmarksCommand(program: Command): void {
  program
    .command("bookmarks")
    .description("List your bookmarked posts")
    .option("-n, --limit <n>", "Max results (1-100)", "20")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (opts) => {
      try {
        const userId = await resolveAuthenticatedUserId(opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.getBookmarks(userId, {
          tweetFields: TWEET_FIELDS,
          expansions: EXPANSIONS,
          userFields: USER_FIELDS,
          maxResults: parseInt(opts.limit, 10),
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
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
}

export function registerBookmarkCommand(program: Command): void {
  program
    .command("bookmark <post-id>")
    .description("Bookmark a post")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (postId: string, opts) => {
      try {
        const userId = await resolveAuthenticatedUserId(opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.createBookmark(userId, {
          tweetId: postId,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
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
    .command("unbookmark <post-id>")
    .description("Remove a post from bookmarks")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (postId: string, opts) => {
      try {
        const userId = await resolveAuthenticatedUserId(opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.deleteBookmark(userId, postId);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Unbookmarked post ${postId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
