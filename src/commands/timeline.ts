import { Command } from "commander";
import { apiRequest } from "../lib/api.js";
import {
  buildUserMap,
  formatTweetList,
  type TweetData,
  type UserData,
} from "../lib/format.js";
import { resolveAuthenticatedUserId, resolveUserId } from "../lib/resolve.js";

const TWEET_FIELDS = "created_at,public_metrics,author_id";
const TWEET_EXPANSIONS = "author_id";

interface TimelineResponse {
  data?: TweetData[];
  includes?: { users?: UserData[] };
  meta?: { result_count: number; next_token?: string };
}

export function registerTimelineCommand(program: Command): void {
  program
    .command("timeline [username]")
    .description(
      "View home timeline, or a user's posts with @username argument",
    )
    .option("--limit <n>", "Max results (1-100)", "20")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (username: string | undefined, opts) => {
      try {
        let endpoint: string;

        if (username) {
          // User timeline: look up user ID then fetch their tweets
          const userId = await resolveUserId(username, opts.account);
          endpoint = `/users/${userId}/tweets`;
        } else {
          // Home timeline: authenticated user's reverse-chronological feed
          const myId = await resolveAuthenticatedUserId(opts.account);
          endpoint = `/users/${myId}/timelines/reverse_chronological`;
        }

        const result = (await apiRequest({
          endpoint,
          query: {
            max_results: opts.limit,
            "tweet.fields": TWEET_FIELDS,
            expansions: TWEET_EXPANSIONS,
          },
          account: opts.account,
        })) as TimelineResponse;

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const tweets = result.data ?? [];
        if (tweets.length === 0) {
          console.log("No posts found.");
          return;
        }

        const usersById = buildUserMap(result.includes?.users);

        // Header
        if (username) {
          const clean = username.replace(/^@/, "");
          console.log(`Posts from @${clean}:\n`);
        } else {
          console.log("Home timeline:\n");
        }

        console.log(formatTweetList(tweets, usersById));
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
