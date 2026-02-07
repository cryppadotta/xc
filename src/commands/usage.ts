import { Command } from "commander";
import { apiRequest } from "../lib/api.js";

interface UsageApp {
  app_id?: string;
  app_name?: string;
}

interface DailyUsageEntry {
  date: string;
  usage: Array<{
    app?: UsageApp;
    tweets: number;
  }>;
}

interface UsageResponse {
  data: {
    cap_reset_day?: number;
    daily_project_usage?: DailyUsageEntry[];
  };
}

export function registerUsageCommand(program: Command): void {
  program
    .command("usage")
    .description("Show API usage stats")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (opts) => {
      try {
        const result = (await apiRequest({
          endpoint: "/usage/tweets",
          account: opts.account,
        })) as UsageResponse;

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const { data } = result;
        const days = data.daily_project_usage ?? [];

        if (days.length === 0) {
          console.log("No usage data available.");
          return;
        }

        // Show cap reset day if present
        if (data.cap_reset_day) {
          console.log(`Cap resets on day ${data.cap_reset_day} of each month\n`);
        }

        // Summarize recent daily usage
        console.log("Daily tweet usage:\n");
        for (const day of days) {
          const date = new Date(day.date).toLocaleDateString();
          const total = day.usage.reduce((sum, u) => sum + u.tweets, 0);
          console.log(`  ${date}: ${total.toLocaleString()} tweets`);

          // Show per-app breakdown if multiple apps
          if (day.usage.length > 1) {
            for (const u of day.usage) {
              const appName = u.app?.app_name ?? "unknown";
              console.log(
                `    ${appName}: ${u.tweets.toLocaleString()}`,
              );
            }
          }
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
