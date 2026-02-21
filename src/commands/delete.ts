/**
 * Delete command: remove a post by ID.
 *
 * Usage:
 *   xc delete <post-id>
 */

import { Command } from "commander";
import { getClient } from "../lib/api.js";
import { outputJson } from "../lib/cost.js";

export function registerDeleteCommand(program: Command): void {
  program
    .command("delete <post-id>")
    .description("Delete a post by ID")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (postId: string, opts) => {
      try {
        const client = await getClient(opts.account);
        const result = await client.posts.delete(postId);

        if (opts.json) {
          outputJson(result);
          return;
        }

        console.log(`Deleted post ${postId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
