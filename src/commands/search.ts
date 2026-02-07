import { Command } from "commander";
import { apiRequest } from "../lib/api.js";
import {
  buildUserMap,
  formatTweetList,
  type TweetData,
  type UserData,
} from "../lib/format.js";

const TWEET_FIELDS = "created_at,public_metrics,author_id";
const TWEET_EXPANSIONS = "author_id";

interface SearchResponse {
  data?: TweetData[];
  includes?: { users?: UserData[] };
  meta?: { result_count: number; next_token?: string };
}

export function registerSearchCommand(program: Command): void {
  program
    .command("search <query>")
    .description("Search posts (recent 7 days, or full archive with --archive)")
    .option("--archive", "Search full archive instead of recent")
    .option("--limit <n>", "Max results (10-100, or 10-500 for archive)", "10")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (query: string, opts) => {
      try {
        const endpoint = opts.archive
          ? "/tweets/search/all"
          : "/tweets/search/recent";

        const result = (await apiRequest({
          endpoint,
          query: {
            query,
            max_results: opts.limit,
            "tweet.fields": TWEET_FIELDS,
            expansions: TWEET_EXPANSIONS,
          },
          account: opts.account,
        })) as SearchResponse;

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const tweets = result.data ?? [];
        if (tweets.length === 0) {
          console.log("No results found.");
          return;
        }

        const usersById = buildUserMap(result.includes?.users);
        console.log(formatTweetList(tweets, usersById));

        // Show result count summary
        const count = result.meta?.result_count ?? tweets.length;
        console.log(`\n— ${count} result${count !== 1 ? "s" : ""}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
