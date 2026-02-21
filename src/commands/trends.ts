/**
 * Trends commands: view trending topics.
 *
 * Usage:
 *   xc trends              — personalized trends
 *   xc trends <woeid>      — trends by location (WOEID)
 *   xc trends --global     — worldwide trends (WOEID 1)
 */

import { Command } from "commander";
import { getClient } from "../lib/api.js";

/** Shape of a trend object from the API. */
interface Trend {
  trendName?: string;
  name?: string;
  tweetCount?: number;
  description?: string;
}

export function registerTrendsCommand(program: Command): void {
  program
    .command("trends [woeid]")
    .description("View trending topics (personalized, by WOEID, or --global)")
    .option("--global", "Show worldwide trends (WOEID 1)")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (woeid: string | undefined, opts) => {
      try {
        const client = await getClient(opts.account);

        let result;
        const locationId = opts.global ? 1 : woeid ? parseInt(woeid, 10) : undefined;

        if (locationId !== undefined) {
          result = await client.trends.getByWoeid(locationId);
        } else {
          result = await client.trends.getPersonalized();
        }

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const trends = (result.data ?? []) as Trend[];
        if (trends.length === 0) {
          console.log("No trends found.");
          return;
        }

        const label = locationId !== undefined
          ? locationId === 1
            ? "Worldwide"
            : `WOEID ${locationId}`
          : "Personalized";
        console.log(`${label} trends:\n`);

        for (let i = 0; i < trends.length; i++) {
          const trend = trends[i];
          const name = trend.trendName ?? trend.name ?? "Unknown";
          const countStr = trend.tweetCount
            ? ` (${trend.tweetCount.toLocaleString()} posts)`
            : "";
          console.log(`  ${i + 1}. ${name}${countStr}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
