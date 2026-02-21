/**
 * Lists commands: view, create, update, delete, manage members, follow/pin.
 *
 * Usage:
 *   xc lists                                — list your lists
 *   xc list <list-id>                       — view posts in a list
 *   xc list create <name> [options]         — create a list
 *   xc list update <id> [options]           — update a list
 *   xc list delete <id>                     — delete a list
 *   xc list members <id>                    — list members
 *   xc list add <id> <username>             — add a member
 *   xc list remove <id> <username>          — remove a member
 *   xc list follow <id>                     — follow a list
 *   xc list unfollow <id>                   — unfollow a list
 *   xc list pin <id>                        — pin a list
 *   xc list unpin <id>                      — unpin a list
 */

import { Command } from "commander";
import { getClient } from "../lib/api.js";
import {
  resolveAuthenticatedUserId,
  resolveUserId,
} from "../lib/resolve.js";
import {
  buildUserMap,
  formatTweetList,
  formatUserLine,
  type UserResult,
} from "../lib/format.js";

const TWEET_FIELDS = ["created_at", "public_metrics", "author_id"];
const EXPANSIONS = ["author_id"];
const USER_FIELDS = ["name", "username"];

/** Shape of a list object from the API. */
interface XList {
  id?: string;
  name?: string;
  description?: string;
  memberCount?: number;
  followerCount?: number;
  private?: boolean;
}

export function registerListsCommand(program: Command): void {
  program
    .command("lists")
    .description("List your owned lists")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (opts) => {
      try {
        const userId = await resolveAuthenticatedUserId(opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.getOwnedLists(userId, {
          listFields: ["description", "member_count", "follower_count", "private"],
        } as Parameters<typeof client.users.getOwnedLists>[1]);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const lists = (result.data ?? []) as XList[];
        if (lists.length === 0) {
          console.log("No lists found.");
          return;
        }

        console.log("Your lists:\n");
        for (const list of lists) {
          const visibility = list.private ? " (private)" : "";
          console.log(`  ${list.name}${visibility}  [id:${list.id}]`);
          if (list.description) {
            console.log(`    ${list.description}`);
          }
          const parts: string[] = [];
          if (list.memberCount !== undefined) {
            parts.push(`${list.memberCount} members`);
          }
          if (list.followerCount !== undefined) {
            parts.push(`${list.followerCount} followers`);
          }
          if (parts.length > 0) {
            console.log(`    ${parts.join(" · ")}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

export function registerListCommand(program: Command): void {
  const list = program
    .command("list")
    .description("List operations (view posts, create, update, delete, members, follow, pin)");

  // Default: xc list <list-id> — view posts in a list
  list
    .command("view <list-id>")
    .description("View posts in a list")
    .option("-n, --limit <n>", "Max results (1-100)", "20")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (listId: string, opts) => {
      try {
        const client = await getClient(opts.account);

        const result = await client.lists.getPosts(listId, {
          tweetFields: TWEET_FIELDS,
          expansions: EXPANSIONS,
          userFields: USER_FIELDS,
          maxResults: parseInt(opts.limit, 10),
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const tweets = result.data ?? [];
        if (tweets.length === 0) {
          console.log("No posts in this list.");
          return;
        }

        const usersById = buildUserMap(result.includes?.users);
        console.log(formatTweetList(tweets, usersById));
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // xc list create <name>
  list
    .command("create <name>")
    .description("Create a new list")
    .option("--description <text>", "List description")
    .option("--private", "Make the list private")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (name: string, opts) => {
      try {
        const client = await getClient(opts.account);

        const body: { name: string; description?: string; private?: boolean } = { name };
        if (opts.description) body.description = opts.description;
        if (opts.private) body.private = true;

        const result = await client.lists.create({ body });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const data = (result as unknown as { data?: Record<string, unknown> }).data;
        console.log(`Created list "${name}" (id:${data?.id ?? "unknown"})`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // xc list update <id>
  list
    .command("update <list-id>")
    .description("Update a list")
    .option("--name <name>", "New list name")
    .option("--description <text>", "New description")
    .option("--private", "Make private")
    .option("--public", "Make public")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (listId: string, opts) => {
      try {
        const client = await getClient(opts.account);

        const body: Record<string, unknown> = {};
        if (opts.name) body.name = opts.name;
        if (opts.description) body.description = opts.description;
        if (opts.private) body.private = true;
        if (opts.public) body.private = false;

        const result = await client.lists.update(listId, { body });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Updated list ${listId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // xc list delete <id>
  list
    .command("delete <list-id>")
    .description("Delete a list")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (listId: string, opts) => {
      try {
        const client = await getClient(opts.account);

        const result = await client.lists.delete(listId);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Deleted list ${listId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // xc list members <id>
  list
    .command("members <list-id>")
    .description("List members of a list")
    .option("-n, --limit <n>", "Max results (1-100)", "100")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (listId: string, opts) => {
      try {
        const client = await getClient(opts.account);

        const result = await client.lists.getMembers(listId, {
          userFields: ["username", "name", "public_metrics"],
          maxResults: parseInt(opts.limit, 10),
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const users = (result.data ?? []) as UserResult[];
        if (users.length === 0) {
          console.log("No members in this list.");
          return;
        }

        console.log(`Members of list ${listId}:\n`);
        for (const user of users) {
          console.log(formatUserLine(user));
        }
        console.log(`\n— ${users.length} shown`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // xc list add <id> <username>
  list
    .command("add <list-id> <username>")
    .description("Add a member to a list")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (listId: string, username: string, opts) => {
      try {
        const targetId = await resolveUserId(username, opts.account);
        const client = await getClient(opts.account);

        const result = await client.lists.addMember(listId, {
          body: { userId: targetId },
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Added @${username.replace(/^@/, "")} to list ${listId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // xc list remove <id> <username>
  list
    .command("remove <list-id> <username>")
    .description("Remove a member from a list")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (listId: string, username: string, opts) => {
      try {
        const targetId = await resolveUserId(username, opts.account);
        const client = await getClient(opts.account);

        const result = await client.lists.removeMemberByUserId(listId, targetId);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Removed @${username.replace(/^@/, "")} from list ${listId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // xc list follow <id>
  list
    .command("follow <list-id>")
    .description("Follow a list")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (listId: string, opts) => {
      try {
        const userId = await resolveAuthenticatedUserId(opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.followList(userId, {
          body: { listId },
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Following list ${listId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // xc list unfollow <id>
  list
    .command("unfollow <list-id>")
    .description("Unfollow a list")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (listId: string, opts) => {
      try {
        const userId = await resolveAuthenticatedUserId(opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.unfollowList(userId, listId);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Unfollowed list ${listId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // xc list pin <id>
  list
    .command("pin <list-id>")
    .description("Pin a list")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (listId: string, opts) => {
      try {
        const userId = await resolveAuthenticatedUserId(opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.pinList(userId, { listId });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Pinned list ${listId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // xc list unpin <id>
  list
    .command("unpin <list-id>")
    .description("Unpin a list")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (listId: string, opts) => {
      try {
        const userId = await resolveAuthenticatedUserId(opts.account);
        const client = await getClient(opts.account);

        const result = await client.users.unpinList(userId, listId);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Unpinned list ${listId}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
