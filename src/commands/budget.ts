/**
 * `xc budget` — manage daily API cost budget.
 * Subcommands: set, show, reset, lock, unlock.
 *
 * When locked with a password, set/reset require --password.
 * show and cost do NOT require a password.
 */

import { Command } from "commander";
import {
  loadBudget,
  saveBudget,
  resetBudget,
  isLocked,
  verifyPassword,
  lockBudget,
  unlockBudget,
  type BudgetAction,
} from "../lib/budget.js";
import { loadUsageLog, computeTodaySpend } from "../lib/cost.js";

const VALID_ACTIONS: BudgetAction[] = ["block", "warn", "confirm"];

/**
 * If the budget is locked, verify the provided password.
 * Exits with error if locked and password is missing or incorrect.
 */
function requirePasswordIfLocked(password?: string): void {
  if (!isLocked()) return;

  if (!password) {
    console.error("Error: budget is locked. Provide --password to continue.");
    process.exit(1);
  }

  if (!verifyPassword(password)) {
    console.error("Error: incorrect password.");
    process.exit(1);
  }
}

export function registerBudgetCommand(program: Command): void {
  const budget = program
    .command("budget")
    .description("Manage API cost budget");

  // xc budget set --daily 2.00 --action warn [--password <pass>]
  budget
    .command("set")
    .description("Set daily budget limit")
    .requiredOption("--daily <amount>", "Daily budget in dollars")
    .option(
      "--action <action>",
      "Action when exceeded: block, warn, confirm",
      "warn",
    )
    .option("--password <pass>", "Password (required if budget is locked)")
    .action((opts) => {
      requirePasswordIfLocked(opts.password);

      const daily = parseFloat(opts.daily);
      if (isNaN(daily) || daily <= 0) {
        console.error("Error: --daily must be a positive number.");
        process.exit(1);
      }

      const action = opts.action as BudgetAction;
      if (!VALID_ACTIONS.includes(action)) {
        console.error("Error: --action must be block, warn, or confirm.");
        process.exit(1);
      }

      // Preserve existing password lock when updating budget
      const existing = loadBudget();
      saveBudget({
        daily,
        action,
        passwordHash: existing.passwordHash,
        passwordSalt: existing.passwordSalt,
      });
      console.log(`Budget set: $${daily.toFixed(2)}/day (action: ${action})`);
    });

  // xc budget show — does NOT require password
  budget
    .command("show")
    .description("Show current budget and today's spend")
    .action(() => {
      const config = loadBudget();
      const entries = loadUsageLog();
      const todaySpend = computeTodaySpend(entries);

      if (!config.daily) {
        console.log("No budget configured.\n");
        console.log("Set one with: xc budget set --daily 2.00");
        return;
      }

      const remaining = Math.max(0, config.daily - todaySpend);
      const pct = ((todaySpend / config.daily) * 100).toFixed(0);
      const locked = isLocked();

      console.log("Budget:\n");
      console.log(`  Daily limit: $${config.daily.toFixed(2)}`);
      console.log(`  Today spent: $${todaySpend.toFixed(2)} (${pct}%)`);
      console.log(`  Remaining:   $${remaining.toFixed(2)}`);
      console.log(`  Action:      ${config.action}`);
      console.log(`  Locked:      ${locked ? "yes" : "no"}`);
    });

  // xc budget reset [--password <pass>]
  budget
    .command("reset")
    .description("Remove budget configuration")
    .option("--password <pass>", "Password (required if budget is locked)")
    .action((opts) => {
      requirePasswordIfLocked(opts.password);
      resetBudget();
      console.log("Budget configuration removed.");
    });

  // xc budget lock --password <pass>
  budget
    .command("lock")
    .description("Lock budget with a password")
    .requiredOption("--password <pass>", "Password to lock with")
    .action((opts) => {
      if (isLocked()) {
        console.error("Error: budget is already locked. Unlock first.");
        process.exit(1);
      }

      lockBudget(opts.password);
      console.log("Budget locked. Use --password for set/reset commands.");
    });

  // xc budget unlock --password <pass>
  budget
    .command("unlock")
    .description("Remove password lock from budget")
    .requiredOption("--password <pass>", "Current password")
    .action((opts) => {
      if (!isLocked()) {
        console.log("Budget is not locked.");
        return;
      }

      if (!verifyPassword(opts.password)) {
        console.error("Error: incorrect password.");
        process.exit(1);
      }

      unlockBudget();
      console.log("Budget unlocked.");
    });
}
