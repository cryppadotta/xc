/**
 * Budget enforcement for API cost tracking.
 * Stores budget config in ~/.xc/budget.json.
 * Checks daily spend against configured limits before each API call.
 * Supports optional password protection via scrypt hashing.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { getConfigDir, ensureConfigDir } from "./config.js";
import { loadUsageLog, computeTodaySpend, estimateCost } from "./cost.js";

export type BudgetAction = "block" | "warn" | "confirm";

export interface BudgetConfig {
  daily?: number;
  action: BudgetAction;
  /** scrypt hash of the lock password (hex). */
  passwordHash?: string;
  /** Salt used for scrypt hashing (hex). */
  passwordSalt?: string;
}

/** Path to budget configuration file. */
export function getBudgetPath(): string {
  return path.join(getConfigDir(), "budget.json");
}

/** Load budget config, returning defaults if none exists. */
export function loadBudget(): BudgetConfig {
  const budgetPath = getBudgetPath();
  if (!fs.existsSync(budgetPath)) {
    return { action: "warn" };
  }
  const raw = fs.readFileSync(budgetPath, "utf-8");
  return JSON.parse(raw) as BudgetConfig;
}

/** Save budget config to disk. */
export function saveBudget(config: BudgetConfig): void {
  ensureConfigDir();
  fs.writeFileSync(getBudgetPath(), JSON.stringify(config, null, 2) + "\n");
}

/** Remove budget configuration entirely. */
export function resetBudget(): void {
  const budgetPath = getBudgetPath();
  if (fs.existsSync(budgetPath)) {
    fs.unlinkSync(budgetPath);
  }
}

/** Hash a password with scrypt using the given salt. Returns hex string. */
export function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

/** Check if the budget is password-locked. */
export function isLocked(): boolean {
  const budget = loadBudget();
  return !!(budget.passwordHash && budget.passwordSalt);
}

/** Verify a password against the stored hash. Returns true if correct. */
export function verifyPassword(password: string): boolean {
  const budget = loadBudget();
  if (!budget.passwordHash || !budget.passwordSalt) return true;
  const hash = hashPassword(password, budget.passwordSalt);
  return hash === budget.passwordHash;
}

/**
 * Lock the budget with a password.
 * Generates a random salt and stores the scrypt hash.
 */
export function lockBudget(password: string): void {
  const budget = loadBudget();
  const salt = crypto.randomBytes(32).toString("hex");
  budget.passwordSalt = salt;
  budget.passwordHash = hashPassword(password, salt);
  saveBudget(budget);
}

/** Remove the password lock from the budget. */
export function unlockBudget(): void {
  const budget = loadBudget();
  delete budget.passwordHash;
  delete budget.passwordSalt;
  saveBudget(budget);
}

/** Prompt the user for y/N confirmation on stderr. */
async function confirmPrompt(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

/**
 * Check whether an API call would exceed the daily budget.
 * Behavior depends on the configured action:
 *   block   — throw, refusing the call
 *   warn    — print warning to stderr, proceed
 *   confirm — prompt user, throw if declined
 */
export async function checkBudget(endpoint: string): Promise<void> {
  const budget = loadBudget();
  if (!budget.daily) return;

  const entries = loadUsageLog();
  const todaySpend = computeTodaySpend(entries);
  const callCost = estimateCost(endpoint);

  if (todaySpend + callCost <= budget.daily) return;

  const msg =
    `Daily budget $${budget.daily.toFixed(2)} exceeded ` +
    `(today: $${todaySpend.toFixed(2)} + $${callCost.toFixed(2)})`;

  switch (budget.action) {
    case "block":
      throw new Error(
        `${msg}. Use 'xc budget reset' or increase your budget.`,
      );

    case "warn":
      console.error(`Warning: ${msg}`);
      break;

    case "confirm": {
      const proceed = await confirmPrompt(`${msg}. Continue?`);
      if (!proceed) {
        throw new Error("Cancelled by user.");
      }
      break;
    }
  }
}
