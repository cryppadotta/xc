/**
 * Stream commands: manage filtered stream rules and connect to the stream.
 *
 * Subcommands:
 *   xc stream add <query> [--tag <name>]  — add a filtered stream rule
 *   xc stream rules                       — list current rules
 *   xc stream remove <rule-id>            — remove a rule by ID
 *   xc stream clear                       — remove all rules
 *   xc stream connect [--json] [--quiet]  — connect and output matching posts
 */

import { Command } from "commander";
import { getClient } from "../lib/api.js";

/** Register the `stream` command group with its subcommands. */
export function registerStreamCommand(program: Command): void {
  const stream = program
    .command("stream")
    .description("Manage filtered stream rules and connect");

  // --- stream add <query> ---
  stream
    .command("add <query>")
    .description("Add a filtered stream rule")
    .option("--tag <name>", "Label for this rule")
    .option("--account <name>", "Account to use")
    .option("--json", "Output raw JSON")
    .action(async (query: string, opts) => {
      try {
        const client = await getClient(opts.account);

        // Build the add-rules request body
        const rule: { value: string; tag?: string } = { value: query };
        if (opts.tag) rule.tag = opts.tag;

        const result = await client.stream.updateRules({ add: [rule] });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const rules = result.data ?? [];
        if (rules.length > 0) {
          for (const r of rules) {
            console.log(`Added rule ${r.id}: ${r.value}${r.tag ? ` [${r.tag}]` : ""}`);
          }
        } else {
          console.log("No rules added.");
          // Show errors if present
          if (result.errors) {
            for (const e of result.errors) {
              console.error(`  Error: ${JSON.stringify(e)}`);
            }
          }
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // --- stream rules ---
  stream
    .command("rules")
    .description("List current filtered stream rules")
    .option("--account <name>", "Account to use")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      try {
        const client = await getClient(opts.account);
        const result = await client.stream.getRules();

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const rules = result.data ?? [];
        if (rules.length === 0) {
          console.log("No rules configured.");
          return;
        }

        for (const r of rules) {
          const tag = r.tag ? ` [${r.tag}]` : "";
          console.log(`  ${r.id}  ${r.value}${tag}`);
        }
        console.log(`\n${rules.length} rule${rules.length !== 1 ? "s" : ""}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // --- stream remove <rule-id> ---
  stream
    .command("remove <ruleId>")
    .description("Remove a filtered stream rule by ID")
    .option("--account <name>", "Account to use")
    .option("--json", "Output raw JSON")
    .action(async (ruleId: string, opts) => {
      try {
        const client = await getClient(opts.account);
        const result = await client.stream.updateRules({
          delete: { ids: [ruleId] },
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const summary = result.meta?.summary as
          | { deleted?: number }
          | undefined;
        const deleted = summary?.deleted ?? 0;

        if (deleted > 0) {
          console.log(`Removed rule ${ruleId}`);
        } else {
          console.log(`Rule ${ruleId} not found or already removed.`);
          if (result.errors) {
            for (const e of result.errors) {
              console.error(`  Error: ${JSON.stringify(e)}`);
            }
          }
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // --- stream clear ---
  stream
    .command("clear")
    .description("Remove all filtered stream rules")
    .option("--account <name>", "Account to use")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      try {
        const client = await getClient(opts.account);

        // First get all current rule IDs
        const current = await client.stream.getRules();
        const rules = current.data ?? [];

        if (rules.length === 0) {
          console.log("No rules to remove.");
          return;
        }

        const ids = rules
          .map((r: { id?: string }) => r.id)
          .filter((id): id is string => !!id);

        const result = await client.stream.updateRules({
          delete: { ids },
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const summary = result.meta?.summary as
          | { deleted?: number }
          | undefined;
        const deleted = summary?.deleted ?? ids.length;
        console.log(`Cleared ${deleted} rule${deleted !== 1 ? "s" : ""}.`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // --- stream connect ---
  stream
    .command("connect")
    .description("Connect to filtered stream and output posts as they arrive")
    .option("--json", "Output raw JSON lines")
    .option("--quiet", "Output only post IDs")
    .option("--account <name>", "Account to use")
    .action(async (opts) => {
      try {
        const client = await getClient(opts.account);

        // Connect to the filtered stream with tweet fields for human-readable output
        const streamOpts: Record<string, unknown> = {};
        if (!opts.quiet) {
          streamOpts.tweetFields = ["created_at", "author_id", "text"];
          streamOpts.expansions = ["author_id"];
          streamOpts.userFields = ["name", "username"];
        }

        console.error("Connecting to filtered stream...");
        const eventStream = await client.stream.posts(streamOpts);

        // Handle graceful shutdown on Ctrl+C
        const cleanup = () => {
          console.error("\nDisconnecting...");
          eventStream.close();
          process.exit(0);
        };
        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

        console.error("Connected. Waiting for posts... (Ctrl+C to stop)\n");

        // Listen for data events using the async iterator
        for await (const event of eventStream) {
          if (opts.json) {
            // Raw JSON lines mode
            console.log(JSON.stringify(event));
          } else if (opts.quiet) {
            // Just post IDs
            const id = event.data?.id;
            if (id) console.log(id);
          } else {
            // Human-readable output
            formatStreamEvent(event);
          }
        }

        console.error("Stream ended.");
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

/** Print a single streamed tweet event in human-readable format. */
function formatStreamEvent(event: {
  data?: Record<string, unknown>;
  includes?: { users?: Array<Record<string, unknown>> };
  matching_rules?: Array<{ id?: string; tag?: string }>;
}): void {
  const tweet = event.data;
  if (!tweet) return;

  const lines: string[] = [];

  // Try to find author from includes
  const authorId = tweet.author_id as string | undefined;
  const users = event.includes?.users ?? [];
  const author = authorId
    ? users.find((u) => u.id === authorId)
    : undefined;

  if (author) {
    lines.push(`@${author.username} (${author.name})`);
  }

  // Tweet text
  const text = (tweet.text as string) ?? "";
  lines.push(`  ${text.replace(/\n/g, "\n  ")}`);

  // Matched rules
  const rules = event.matching_rules ?? [];
  if (rules.length > 0) {
    const ruleLabels = rules
      .map((r) => r.tag ?? r.id ?? "unknown")
      .join(", ");
    lines.push(`  rules: ${ruleLabels}`);
  }

  // ID and timestamp
  const meta: string[] = [];
  if (tweet.created_at) {
    meta.push(new Date(tweet.created_at as string).toLocaleString());
  }
  if (tweet.id) {
    meta.push(`id:${tweet.id}`);
  }
  if (meta.length > 0) {
    lines.push(`  ${meta.join(" · ")}`);
  }

  console.log(lines.join("\n"));
  console.log(); // blank line between tweets
}
