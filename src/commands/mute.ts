/**
 * Mute/unmute/muted commands.
 *
 * Usage:
 *   xc mute <username>    — mute a user
 *   xc unmute <username>  — unmute a user
 *   xc muted              — list muted users
 */

import { Command } from "commander";
import { getClient } from "../lib/api.js";
import { outputJson } from "../lib/cost.js";
import {
  resolveAuthenticatedUserId,
  resolveUserId,
} from "../lib/resolve.js";
import { formatUserLine, type UserResult } from "../lib/format.js";

export function registerMuteCommand(program: Command): void {
  program
    .command("mute <username>")
    .description("Mute a user")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (username: string, opts) => {
      try {
        const myId = await resolveAuthenticatedUserId(opts.account);
        const targetId = await resolveUserId(username, opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.muteUser(myId, {
          body: { targetUserId: targetId },
        });

        if (opts.json) {
          outputJson(result);
          return;
        }

        console.log(`Muted @${username.replace(/^@/, "")}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

export function registerUnmuteCommand(program: Command): void {
  program
    .command("unmute <username>")
    .description("Unmute a user")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (username: string, opts) => {
      try {
        const myId = await resolveAuthenticatedUserId(opts.account);
        const targetId = await resolveUserId(username, opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.unmuteUser(myId, targetId);

        if (opts.json) {
          outputJson(result);
          return;
        }

        console.log(`Unmuted @${username.replace(/^@/, "")}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

export function registerMutedCommand(program: Command): void {
  program
    .command("muted")
    .description("List muted users")
    .option("-n, --limit <n>", "Max results (1-1000)", "100")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (opts) => {
      try {
        const userId = await resolveAuthenticatedUserId(opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.getMuting(userId, {
          userFields: ["username", "name", "public_metrics", "description"],
          maxResults: parseInt(opts.limit, 10),
        });

        if (opts.json) {
          outputJson(result);
          return;
        }

        const users = (result.data ?? []) as UserResult[];
        if (users.length === 0) {
          console.log("No muted users.");
          return;
        }

        console.log("Muted users:\n");
        for (const user of users) {
          console.log(formatUserLine(user));
        }
        console.log(`\n— ${users.length} shown`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
