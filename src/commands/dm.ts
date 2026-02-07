/**
 * DM commands: send, list, and view message history.
 *
 * Usage:
 *   xc dm send <@username> <message>
 *   xc dm list
 *   xc dm history <@username>
 */

import { Command } from "commander";
import { getClient } from "../lib/api.js";
import { resolveUserId, resolveAuthenticatedUserId } from "../lib/resolve.js";

/** Shape of a single DM event from the API. */
interface DmEvent {
  id?: string;
  text?: string;
  eventType?: string;
  senderId?: string;
  createdAt?: string;
  dmConversationId?: string;
}

/** Shape of a user object from API includes. */
interface DmUser {
  id?: string;
  username?: string;
  name?: string;
}

/** Format a single DM event for terminal display. */
function formatDmEvent(
  event: DmEvent,
  usersById: Map<string, DmUser>,
): string {
  const lines: string[] = [];
  const sender = event.senderId ? usersById.get(event.senderId) : undefined;
  const who = sender ? `@${sender.username}` : (event.senderId ?? "unknown");
  const time = event.createdAt
    ? new Date(event.createdAt).toLocaleString()
    : "";

  lines.push(`${who}  ${time}`);
  if (event.text) {
    lines.push(`  ${event.text.replace(/\n/g, "\n  ")}`);
  }
  return lines.join("\n");
}

export function registerDmCommand(program: Command): void {
  const dm = program
    .command("dm")
    .description("Direct message operations");

  // xc dm send <@username> <message>
  dm.command("send <username> <message>")
    .description("Send a DM to a user")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (username: string, message: string, opts) => {
      try {
        const participantId = await resolveUserId(username, opts.account);
        const client = await getClient(opts.account);

        const result = await client.directMessages.createByParticipantId(
          participantId,
          { body: { text: message } },
        );

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const eventId =
          (result as Record<string, Record<string, string>>).data
            ?.dmEventId ?? "unknown";
        console.log(`DM sent to @${username.replace(/^@/, "")} (event: ${eventId})`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // xc dm list — list recent DM conversations
  dm.command("list")
    .description("List recent DM conversations")
    .option("--limit <n>", "Max results", "20")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (opts) => {
      try {
        const client = await getClient(opts.account);

        const result = await client.directMessages.getEvents({
          maxResults: Math.min(parseInt(opts.limit, 10), 100),
          dmEventFields: [
            "id",
            "text",
            "event_type",
            "sender_id",
            "created_at",
            "dm_conversation_id",
          ],
          expansions: ["sender_id"],
          userFields: ["username", "name"],
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const events = (result.data ?? []) as DmEvent[];
        if (events.length === 0) {
          console.log("No recent DM conversations.");
          return;
        }

        // Build user lookup from includes
        const usersById = new Map<string, DmUser>();
        const includeUsers = (
          result.includes as Record<string, DmUser[]> | undefined
        )?.users;
        if (includeUsers) {
          for (const u of includeUsers) {
            if (u.id) usersById.set(u.id, u);
          }
        }

        // Group by conversation, show latest per conversation
        const seen = new Set<string>();
        const unique: DmEvent[] = [];
        for (const ev of events) {
          const cid = ev.dmConversationId ?? "";
          if (!seen.has(cid)) {
            seen.add(cid);
            unique.push(ev);
          }
        }

        console.log("Recent DM conversations:\n");
        for (const ev of unique) {
          console.log(formatDmEvent(ev, usersById));
          console.log();
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // xc dm history <@username> — message history with a user
  dm.command("history <username>")
    .description("View DM history with a user")
    .option("--limit <n>", "Max results", "20")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (username: string, opts) => {
      try {
        const participantId = await resolveUserId(username, opts.account);
        const client = await getClient(opts.account);

        const result = await client.directMessages.getEventsByParticipantId(
          participantId,
          {
            maxResults: Math.min(parseInt(opts.limit, 10), 100),
            dmEventFields: [
              "id",
              "text",
              "event_type",
              "sender_id",
              "created_at",
            ],
            expansions: ["sender_id"],
            userFields: ["username", "name"],
          },
        );

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const events = (result.data ?? []) as DmEvent[];
        if (events.length === 0) {
          console.log(
            `No messages with @${username.replace(/^@/, "")}.`,
          );
          return;
        }

        // Build user lookup from includes
        const usersById = new Map<string, DmUser>();
        const includeUsers = (
          result.includes as Record<string, DmUser[]> | undefined
        )?.users;
        if (includeUsers) {
          for (const u of includeUsers) {
            if (u.id) usersById.set(u.id, u);
          }
        }

        // Get our own user ID for labeling
        const myId = await resolveAuthenticatedUserId(opts.account);

        const clean = username.replace(/^@/, "");
        console.log(`DM history with @${clean}:\n`);

        // Events come newest-first; reverse for chronological display
        const chronological = [...events].reverse();
        for (const ev of chronological) {
          const isMine = ev.senderId === myId;
          const label = isMine ? "You" : `@${clean}`;
          const time = ev.createdAt
            ? new Date(ev.createdAt).toLocaleString()
            : "";

          console.log(`${label}  ${time}`);
          if (ev.text) {
            console.log(`  ${ev.text.replace(/\n/g, "\n  ")}`);
          }
          console.log();
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
