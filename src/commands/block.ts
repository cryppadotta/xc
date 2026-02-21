/**
 * Block/unblock/blocked commands.
 *
 * Note: The XDK SDK does not expose block/unblock user methods (only blockDms/unblockDms).
 * We use the Client's httpClient for raw POST/DELETE to the X API v2 block endpoints.
 *
 * Usage:
 *   xc block <username>    — block a user
 *   xc unblock <username>  — unblock a user
 *   xc blocked             — list blocked users
 */

import { Command } from "commander";
import { getClient } from "../lib/api.js";
import {
  resolveAuthenticatedUserId,
  resolveUserId,
} from "../lib/resolve.js";
import { formatUserLine, type UserResult } from "../lib/format.js";

export function registerBlockCommand(program: Command): void {
  program
    .command("block <username>")
    .description("Block a user")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (username: string, opts) => {
      try {
        const myId = await resolveAuthenticatedUserId(opts.account);
        const targetId = await resolveUserId(username, opts.account);
        const client = await getClient(opts.account);

        // SDK gap: no blockUser method — use raw HTTP
        const c = client as unknown as { baseUrl: string; httpClient: { post(url: string, body?: string, headers?: Record<string, string>): Promise<{ body: string; status: number }> }; headers: Headers; accessToken?: string; bearerToken?: string };
        const token = c.accessToken ?? c.bearerToken ?? "";
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        };
        const url = `${c.baseUrl || "https://api.x.com"}/2/users/${myId}/blocking`;
        const response = await c.httpClient.post(
          url,
          JSON.stringify({ target_user_id: targetId }),
          headers,
        );
        const result = JSON.parse(response.body);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Blocked @${username.replace(/^@/, "")}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

export function registerUnblockCommand(program: Command): void {
  program
    .command("unblock <username>")
    .description("Unblock a user")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (username: string, opts) => {
      try {
        const myId = await resolveAuthenticatedUserId(opts.account);
        const targetId = await resolveUserId(username, opts.account);
        const client = await getClient(opts.account);

        // SDK gap: no unblockUser method — use raw HTTP
        const c = client as unknown as { baseUrl: string; httpClient: { delete(url: string, headers?: Record<string, string>): Promise<{ body: string; status: number }> }; headers: Headers; accessToken?: string; bearerToken?: string };
        const token = c.accessToken ?? c.bearerToken ?? "";
        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
        };
        const url = `${c.baseUrl || "https://api.x.com"}/2/users/${myId}/blocking/${targetId}`;
        const response = await c.httpClient.delete(url, headers);
        const result = JSON.parse(response.body);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Unblocked @${username.replace(/^@/, "")}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

export function registerBlockedCommand(program: Command): void {
  program
    .command("blocked")
    .description("List blocked users")
    .option("-n, --limit <n>", "Max results (1-1000)", "100")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (opts) => {
      try {
        const userId = await resolveAuthenticatedUserId(opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.getBlocking(userId, {
          userFields: ["username", "name", "public_metrics", "description"],
          maxResults: parseInt(opts.limit, 10),
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const users = (result.data ?? []) as UserResult[];
        if (users.length === 0) {
          console.log("No blocked users.");
          return;
        }

        console.log("Blocked users:\n");
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
