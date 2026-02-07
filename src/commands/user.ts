import { Command } from "commander";
import { apiRequest } from "../lib/api.js";

const USER_FIELDS = "created_at,description,public_metrics";

interface UserResponse {
  data: {
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
  };
}

export function registerUserCommand(program: Command): void {
  program
    .command("user <username>")
    .description("Look up a user by @username")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (username: string, opts) => {
      try {
        const clean = username.replace(/^@/, "");

        const result = (await apiRequest({
          endpoint: `/users/by/username/${encodeURIComponent(clean)}`,
          query: { "user.fields": USER_FIELDS },
          account: opts.account,
        })) as UserResponse;

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const { data } = result;
        const m = data.public_metrics;

        console.log(`@${data.username} (${data.name})`);
        if (data.description) console.log(`  ${data.description}`);
        if (m) {
          console.log(
            `  ${m.followers_count.toLocaleString()} followers · ${m.following_count.toLocaleString()} following · ${m.tweet_count.toLocaleString()} posts`,
          );
        }
        if (data.created_at) {
          console.log(
            `  Joined ${new Date(data.created_at).toLocaleDateString()}`,
          );
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
