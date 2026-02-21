/**
 * Hide/unhide reply moderation commands.
 *
 * Usage:
 *   xc hide <post-id>    — hide a reply
 *   xc unhide <post-id>  — unhide a reply
 */

import { Command } from "commander";
import { getClient } from "../lib/api.js";

export function registerHideCommand(program: Command): void {
  program
    .command("hide <post-id>")
    .description("Hide a reply")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (postId: string, opts) => {
      try {
        const client = await getClient(opts.account);

        const result = await client.posts.hideReply(postId, {
          body: { hidden: true },
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Hidden reply ${postId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

export function registerUnhideCommand(program: Command): void {
  program
    .command("unhide <post-id>")
    .description("Unhide a reply")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (postId: string, opts) => {
      try {
        const client = await getClient(opts.account);

        const result = await client.posts.hideReply(postId, {
          body: { hidden: false },
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Unhidden reply ${postId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
