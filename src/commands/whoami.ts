import { Command } from "commander";
import { apiRequest } from "../lib/api.js";

export function registerWhoamiCommand(program: Command): void {
  program
    .command("whoami")
    .description("Show the authenticated user")
    .option("--account <name>", "Account to check")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      try {
        const result = (await apiRequest({
          endpoint: "/users/me",
          query: {
            "user.fields":
              "created_at,description,public_metrics,verified,location,url,profile_image_url",
          },
          account: opts.account,
        })) as {
          data: {
            id: string;
            name: string;
            username: string;
            description?: string;
            location?: string;
            url?: string;
            verified?: boolean;
            created_at?: string;
            profile_image_url?: string;
            public_metrics?: {
              followers_count: number;
              following_count: number;
              tweet_count: number;
              listed_count: number;
            };
          };
        };

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const { data } = result;
        const m = data.public_metrics;

        console.log(`@${data.username} (${data.name})`);
        if (data.description) console.log(`  ${data.description}`);
        if (data.location) console.log(`  📍 ${data.location}`);
        if (data.url) console.log(`  🔗 ${data.url}`);
        if (data.verified) console.log(`  ✓ Verified`);
        if (m) {
          console.log(
            `  ${m.followers_count.toLocaleString()} followers · ${m.following_count.toLocaleString()} following · ${m.tweet_count.toLocaleString()} posts`,
          );
        }
        if (data.created_at) {
          console.log(`  Joined ${new Date(data.created_at).toLocaleDateString()}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
