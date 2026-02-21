/**
 * User search command.
 *
 * Usage:
 *   xc usersearch <query>  — search for users by keyword
 */

import { Command } from "commander";
import { getClient } from "../lib/api.js";
import { outputJson } from "../lib/cost.js";
import { formatUserLine, type UserResult } from "../lib/format.js";

export function registerUserSearchCommand(program: Command): void {
  program
    .command("usersearch <query>")
    .description("Search for users by keyword")
    .option("-n, --limit <n>", "Max results (1-100)", "20")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (query: string, opts) => {
      try {
        const client = await getClient(opts.account);

        const result = await client.users.search(query, {
          userFields: ["username", "name", "public_metrics", "description"],
          maxResults: parseInt(opts.limit, 10),
        });

        if (opts.json) {
          outputJson(result);
          return;
        }

        const users = (result.data ?? []) as UserResult[];
        if (users.length === 0) {
          console.log(`No users found for "${query}".`);
          return;
        }

        console.log(`Users matching "${query}":\n`);
        for (const user of users) {
          console.log(formatUserLine(user));
          if (user.description) {
            console.log(`    ${user.description.replace(/\n/g, " ").slice(0, 100)}`);
          }
        }
        console.log(`\n— ${users.length} shown`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
