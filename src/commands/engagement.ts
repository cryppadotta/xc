/**
 * Engagement lookup commands: quote tweets, liking users, reposted-by, liked posts.
 *
 * Usage:
 *   xc quotes <post-id>       — list quote tweets of a post
 *   xc likes <post-id>        — list users who liked a post
 *   xc reposts <post-id>      — list users who reposted a post
 *   xc liked [username]       — list posts liked by a user
 */

import { Command } from "commander";
import { getClient } from "../lib/api.js";
import {
  buildUserMap,
  formatTweetList,
  formatUserLine,
  type UserResult,
} from "../lib/format.js";
import {
  resolveAuthenticatedUserId,
  resolveUserId,
} from "../lib/resolve.js";

const TWEET_FIELDS = ["created_at", "public_metrics", "author_id"];
const EXPANSIONS = ["author_id"];
const USER_FIELDS = ["name", "username", "public_metrics"];

export function registerQuotesCommand(program: Command): void {
  program
    .command("quotes <post-id>")
    .description("List quote tweets of a post")
    .option("-n, --limit <n>", "Max results (1-100)", "20")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (postId: string, opts) => {
      try {
        const client = await getClient(opts.account);

        const result = await client.posts.getQuoted(postId, {
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
          console.log("No quote tweets found.");
          return;
        }

        const usersById = buildUserMap(result.includes?.users);
        console.log(`Quote tweets of ${postId}:\n`);
        console.log(formatTweetList(tweets, usersById));
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

export function registerLikesCommand(program: Command): void {
  program
    .command("likes <post-id>")
    .description("List users who liked a post")
    .option("-n, --limit <n>", "Max results (1-100)", "100")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (postId: string, opts) => {
      try {
        const client = await getClient(opts.account);

        const result = await client.posts.getLikingUsers(postId, {
          userFields: ["username", "name", "public_metrics"],
          maxResults: parseInt(opts.limit, 10),
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const users = (result.data ?? []) as UserResult[];
        if (users.length === 0) {
          console.log("No liking users found.");
          return;
        }

        console.log(`Users who liked post ${postId}:\n`);
        for (const user of users) {
          console.log(formatUserLine(user));
        }
        console.log(`\n— ${users.length} shown`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

export function registerRepostsCommand(program: Command): void {
  program
    .command("reposts <post-id>")
    .description("List users who reposted a post")
    .option("-n, --limit <n>", "Max results (1-100)", "100")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (postId: string, opts) => {
      try {
        const client = await getClient(opts.account);

        const result = await client.posts.getRepostedBy(postId, {
          userFields: ["username", "name", "public_metrics"],
          maxResults: parseInt(opts.limit, 10),
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const users = (result.data ?? []) as UserResult[];
        if (users.length === 0) {
          console.log("No reposting users found.");
          return;
        }

        console.log(`Users who reposted post ${postId}:\n`);
        for (const user of users) {
          console.log(formatUserLine(user));
        }
        console.log(`\n— ${users.length} shown`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

export function registerLikedCommand(program: Command): void {
  program
    .command("liked [username]")
    .description("List posts liked by a user (defaults to authenticated user)")
    .option("-n, --limit <n>", "Max results (1-100)", "20")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (username: string | undefined, opts) => {
      try {
        const client = await getClient(opts.account);

        let userId: string;
        if (username) {
          userId = await resolveUserId(username, opts.account);
        } else {
          userId = await resolveAuthenticatedUserId(opts.account);
        }

        const result = await client.users.getLikedPosts(userId, {
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
          console.log("No liked posts found.");
          return;
        }

        const usersById = buildUserMap(result.includes?.users);
        const label = username
          ? `@${username.replace(/^@/, "")}`
          : "you";
        console.log(`Posts liked by ${label}:\n`);
        console.log(formatTweetList(tweets, usersById));
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
