import { Command } from "commander";
import { apiRequest } from "../lib/api.js";
import { resolveAuthenticatedUserId } from "../lib/resolve.js";

interface LikeResponse {
  data: { liked: boolean };
}

export function registerLikeCommand(program: Command): void {
  program
    .command("like <post-id>")
    .description("Like a post")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (postId: string, opts) => {
      try {
        const userId = await resolveAuthenticatedUserId(opts.account);

        const result = (await apiRequest({
          method: "POST",
          endpoint: `/users/${userId}/likes`,
          body: { tweet_id: postId },
          account: opts.account,
        })) as LikeResponse;

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Liked post ${postId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

export function registerUnlikeCommand(program: Command): void {
  program
    .command("unlike <post-id>")
    .description("Unlike a post")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (postId: string, opts) => {
      try {
        const userId = await resolveAuthenticatedUserId(opts.account);

        const result = (await apiRequest({
          method: "DELETE",
          endpoint: `/users/${userId}/likes/${postId}`,
          account: opts.account,
        })) as LikeResponse;

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Unliked post ${postId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
