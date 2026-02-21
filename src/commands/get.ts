import { Command } from "commander";
import { getClient } from "../lib/api.js";
import { buildUserMap, formatTweet } from "../lib/format.js";

const TWEET_FIELDS = ["created_at", "public_metrics", "author_id", "article", "note_tweet"];
const EXPANSIONS = ["author_id"];
const USER_FIELDS = ["name", "username"];

/**
 * Extract a post ID from a string that may be an ID or a full x.com/twitter.com URL.
 */
function parsePostId(input: string): string {
  const urlMatch = input.match(
    /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/,
  );
  return urlMatch ? urlMatch[1] : input;
}

export function registerGetCommand(program: Command): void {
  program
    .command("get <post-id-or-url>")
    .description("Get a post by ID or URL")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (postIdOrUrl: string, opts) => {
      try {
        const id = parsePostId(postIdOrUrl);
        const client = await getClient(opts.account);

        const result = await client.posts.getById(id, {
          tweetFields: TWEET_FIELDS,
          expansions: EXPANSIONS,
          userFields: USER_FIELDS,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const tweet = result.data;
        if (!tweet) {
          console.log("Post not found.");
          return;
        }

        const usersById = buildUserMap(result.includes?.users);
        console.log(formatTweet(tweet, usersById));

        // Display article body if present
        const article = (tweet as Record<string, any>).article;
        if (article?.plainText) {
          if (article.title) {
            console.log(`\n━━━ ${article.title} ━━━\n`);
          } else {
            console.log("\n━━━ Article ━━━\n");
          }
          console.log(article.plainText);
        }

        // Display note_tweet full text if present (long posts >280 chars)
        const noteTweet = (tweet as Record<string, any>).noteTweet ?? (tweet as Record<string, any>).note_tweet;
        if (noteTweet?.text) {
          console.log(`\n${noteTweet.text}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
