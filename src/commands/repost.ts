/**
 * Repost/unrepost commands.
 *
 * Usage:
 *   xc repost <post-id>    — repost a post
 *   xc unrepost <post-id>  — undo a repost
 */

import { Command } from "commander";
import { getClient } from "../lib/api.js";
import { resolveAuthenticatedUserId } from "../lib/resolve.js";

export function registerRepostCommand(program: Command): void {
  program
    .command("repost <post-id>")
    .description("Repost a post")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (postId: string, opts) => {
      try {
        const userId = await resolveAuthenticatedUserId(opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.repostPost(userId, {
          body: { tweetId: postId },
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Reposted post ${postId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

export function registerUnrepostCommand(program: Command): void {
  program
    .command("unrepost <post-id>")
    .description("Undo a repost")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (postId: string, opts) => {
      try {
        const userId = await resolveAuthenticatedUserId(opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.unrepostPost(userId, postId);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Unreposted post ${postId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
