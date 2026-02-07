import { Command } from "commander";
import { apiRequest } from "../lib/api.js";

interface CreateTweetBody {
  text: string;
  reply?: { in_reply_to_tweet_id: string };
  quote_tweet_id?: string;
}

interface CreateTweetResponse {
  data: { id: string; text: string };
}

export function registerPostCommand(program: Command): void {
  program
    .command("post <text>")
    .description("Create a post")
    .option("--reply <id>", "Reply to a post by ID")
    .option("--quote <id>", "Quote a post by ID")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (text: string, opts) => {
      try {
        // Build request body
        const body: CreateTweetBody = { text };

        if (opts.reply) {
          body.reply = { in_reply_to_tweet_id: opts.reply };
        }
        if (opts.quote) {
          body.quote_tweet_id = opts.quote;
        }

        const result = (await apiRequest({
          method: "POST",
          endpoint: "/tweets",
          body,
          account: opts.account,
        })) as CreateTweetResponse;

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Posted (id: ${result.data.id})`);
        console.log(`  ${result.data.text}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
