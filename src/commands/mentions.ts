/**
 * Mentions timeline command.
 *
 * Usage:
 *   xc mentions [username]  — view mentions (defaults to authenticated user)
 */

import { Command } from "commander";
import { getClient } from "../lib/api.js";
import { outputJson } from "../lib/cost.js";
import { buildUserMap, formatTweetList } from "../lib/format.js";
import {
  resolveAuthenticatedUserId,
  resolveUserId,
} from "../lib/resolve.js";

const TWEET_FIELDS = ["created_at", "public_metrics", "author_id"];
const EXPANSIONS = ["author_id"];
const USER_FIELDS = ["name", "username"];

export function registerMentionsCommand(program: Command): void {
  program
    .command("mentions [username]")
    .description("View mentions timeline (defaults to authenticated user)")
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

        const result = await client.users.getMentions(userId, {
          tweetFields: TWEET_FIELDS,
          expansions: EXPANSIONS,
          userFields: USER_FIELDS,
          maxResults: parseInt(opts.limit, 10),
        });

        if (opts.json) {
          outputJson(result);
          return;
        }

        const tweets = result.data ?? [];
        if (tweets.length === 0) {
          console.log("No mentions found.");
          return;
        }

        const usersById = buildUserMap(result.includes?.users);
        const label = username
          ? `@${username.replace(/^@/, "")}`
          : "your";
        console.log(`Mentions for ${label}:\n`);
        console.log(formatTweetList(tweets, usersById));
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
