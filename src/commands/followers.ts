/**
 * Followers/following commands: view and manage follow relationships.
 *
 * Usage:
 *   xc followers <@username>     — list who follows a user
 *   xc following <@username>     — list who a user follows
 *   xc follow <@username>        — follow a user
 *   xc unfollow <@username>      — unfollow a user
 */

import { Command } from "commander";
import { getClient } from "../lib/api.js";
import {
  resolveUserId,
  resolveAuthenticatedUserId,
} from "../lib/resolve.js";

/** Shape of a user from the API. */
interface UserResult {
  id?: string;
  username?: string;
  name?: string;
  description?: string;
  publicMetrics?: Record<string, number>;
}

/** Format a compact user line for follower/following lists. */
function formatUserLine(user: UserResult): string {
  const parts = [`@${user.username}`];
  if (user.name) parts[0] += ` (${user.name})`;
  if (user.publicMetrics?.followersCount !== undefined) {
    parts.push(
      `${user.publicMetrics.followersCount.toLocaleString()} followers`,
    );
  }
  return `  ${parts.join(" · ")}`;
}

export function registerFollowersCommand(program: Command): void {
  program
    .command("followers <username>")
    .description("List followers of a user")
    .option("--limit <n>", "Max results (1-1000)", "100")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (username: string, opts) => {
      try {
        const userId = await resolveUserId(username, opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.getFollowers(userId, {
          userFields: ["username", "name", "public_metrics", "description"],
          maxResults: parseInt(opts.limit, 10),
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const users = (result.data ?? []) as UserResult[];
        if (users.length === 0) {
          console.log(`@${username.replace(/^@/, "")} has no followers.`);
          return;
        }

        const clean = username.replace(/^@/, "");
        console.log(`Followers of @${clean}:\n`);
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

export function registerFollowingCommand(program: Command): void {
  program
    .command("following <username>")
    .description("List who a user follows")
    .option("--limit <n>", "Max results (1-1000)", "100")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (username: string, opts) => {
      try {
        const userId = await resolveUserId(username, opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.getFollowing(userId, {
          userFields: ["username", "name", "public_metrics", "description"],
          maxResults: parseInt(opts.limit, 10),
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const users = (result.data ?? []) as UserResult[];
        if (users.length === 0) {
          console.log(`@${username.replace(/^@/, "")} follows no one.`);
          return;
        }

        const clean = username.replace(/^@/, "");
        console.log(`@${clean} is following:\n`);
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

export function registerFollowCommand(program: Command): void {
  program
    .command("follow <username>")
    .description("Follow a user")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (username: string, opts) => {
      try {
        const myId = await resolveAuthenticatedUserId(opts.account);
        const targetId = await resolveUserId(username, opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.followUser(myId, {
          body: { targetUserId: targetId },
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Followed @${username.replace(/^@/, "")}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

export function registerUnfollowCommand(program: Command): void {
  program
    .command("unfollow <username>")
    .description("Unfollow a user")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (username: string, opts) => {
      try {
        const myId = await resolveAuthenticatedUserId(opts.account);
        const targetId = await resolveUserId(username, opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.unfollowUser(myId, targetId);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Unfollowed @${username.replace(/^@/, "")}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
