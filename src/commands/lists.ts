/**
 * Lists commands: view owned lists and list timelines.
 *
 * Usage:
 *   xc lists              — list your lists
 *   xc list <list-id>     — view posts in a list
 */

import { Command } from "commander";
import { getClient } from "../lib/api.js";
import { resolveAuthenticatedUserId } from "../lib/resolve.js";
import { buildUserMap, formatTweetList } from "../lib/format.js";

const TWEET_FIELDS = ["created_at", "public_metrics", "author_id"];
const EXPANSIONS = ["author_id"];
const USER_FIELDS = ["name", "username"];

/** Shape of a list object from the API. */
interface XList {
  id?: string;
  name?: string;
  description?: string;
  memberCount?: number;
  followerCount?: number;
  private?: boolean;
}

export function registerListsCommand(program: Command): void {
  program
    .command("lists")
    .description("List your owned lists")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (opts) => {
      try {
        const userId = await resolveAuthenticatedUserId(opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.getOwnedLists(userId, {
          listFields: ["description", "member_count", "follower_count", "private"],
        } as Parameters<typeof client.users.getOwnedLists>[1]);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const lists = (result.data ?? []) as XList[];
        if (lists.length === 0) {
          console.log("No lists found.");
          return;
        }

        console.log("Your lists:\n");
        for (const list of lists) {
          const visibility = list.private ? " (private)" : "";
          console.log(`  ${list.name}${visibility}  [id:${list.id}]`);
          if (list.description) {
            console.log(`    ${list.description}`);
          }
          const parts: string[] = [];
          if (list.memberCount !== undefined) {
            parts.push(`${list.memberCount} members`);
          }
          if (list.followerCount !== undefined) {
            parts.push(`${list.followerCount} followers`);
          }
          if (parts.length > 0) {
            console.log(`    ${parts.join(" · ")}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

export function registerListCommand(program: Command): void {
  program
    .command("list <list-id>")
    .description("View posts in a list")
    .option("--limit <n>", "Max results (1-100)", "20")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (listId: string, opts) => {
      try {
        const client = await getClient(opts.account);

        const result = await client.lists.getPosts(listId, {
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
          console.log("No posts in this list.");
          return;
        }

        const usersById = buildUserMap(result.includes?.users);
        console.log(formatTweetList(tweets, usersById));
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
