/**
 * Tests for budget enforcement: load/save, password locking, and checkBudget.
 * Uses vi.resetModules() + dynamic import for filesystem isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** Shape of the dynamically imported budget module. */
type BudgetModule = typeof import("../../lib/budget.js");

let tmpDir: string;
let origConfigDir: string | undefined;
let budget: BudgetModule;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xc-budget-lib-test-"));
  origConfigDir = process.env.XC_CONFIG_DIR;
  process.env.XC_CONFIG_DIR = tmpDir;

  vi.resetModules();
  budget = await import("../../lib/budget.js");
});

afterEach(() => {
  if (origConfigDir !== undefined) {
    process.env.XC_CONFIG_DIR = origConfigDir;
  } else {
    delete process.env.XC_CONFIG_DIR;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a budget.json directly into the temp config dir. */
function writeBudgetFile(config: object): void {
  fs.writeFileSync(
    path.join(tmpDir, "budget.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
}

/** Write usage entries into usage.jsonl in the temp config dir. */
function writeUsageLog(
  entries: Array<{
    timestamp: string;
    endpoint: string;
    method: string;
    estimatedCost: number;
  }>,
): void {
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(path.join(tmpDir, "usage.jsonl"), lines);
}

describe("budget basics", () => {
  it("returns defaults when no budget file exists", () => {
    const b = budget.loadBudget();
    expect(b.action).toBe("warn");
    expect(b.daily).toBeUndefined();
  });

  it("saves and loads budget config", () => {
    budget.saveBudget({ daily: 5.0, action: "block" });
    const b = budget.loadBudget();
    expect(b.daily).toBe(5.0);
    expect(b.action).toBe("block");
  });

  it("resets budget by removing file", () => {
    budget.saveBudget({ daily: 5.0, action: "warn" });
    expect(fs.existsSync(budget.getBudgetPath())).toBe(true);
    budget.resetBudget();
    expect(fs.existsSync(budget.getBudgetPath())).toBe(false);
  });

  it("reset is safe when no file exists", () => {
    expect(() => budget.resetBudget()).not.toThrow();
  });

  it("getBudgetPath returns path inside config dir", () => {
    expect(budget.getBudgetPath()).toBe(path.join(tmpDir, "budget.json"));
  });
});

describe("password hashing", () => {
  it("produces consistent hashes with same salt", () => {
    const salt = "abcdef1234567890";
    const h1 = budget.hashPassword("mypassword", salt);
    const h2 = budget.hashPassword("mypassword", salt);
    expect(h1).toBe(h2);
  });

  it("produces different hashes with different salts", () => {
    const h1 = budget.hashPassword("mypassword", "salt1");
    const h2 = budget.hashPassword("mypassword", "salt2");
    expect(h1).not.toBe(h2);
  });

  it("produces different hashes for different passwords", () => {
    const salt = "samesalt";
    const h1 = budget.hashPassword("password1", salt);
    const h2 = budget.hashPassword("password2", salt);
    expect(h1).not.toBe(h2);
  });

  it("returns a 128-char hex string (64-byte scrypt key)", () => {
    const hash = budget.hashPassword("test", "salt");
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash).toHaveLength(128);
  });
});

describe("budget locking", () => {
  it("reports unlocked when no password set", () => {
    budget.saveBudget({ daily: 5.0, action: "warn" });
    expect(budget.isLocked()).toBe(false);
  });

  it("locks budget with password", () => {
    budget.saveBudget({ daily: 5.0, action: "warn" });
    budget.lockBudget("secret123");
    expect(budget.isLocked()).toBe(true);
  });

  it("verifies correct password", () => {
    budget.saveBudget({ daily: 5.0, action: "warn" });
    budget.lockBudget("secret123");
    expect(budget.verifyPassword("secret123")).toBe(true);
  });

  it("rejects incorrect password", () => {
    budget.saveBudget({ daily: 5.0, action: "warn" });
    budget.lockBudget("secret123");
    expect(budget.verifyPassword("wrong")).toBe(false);
  });

  it("unlocks budget and removes password fields", () => {
    budget.saveBudget({ daily: 5.0, action: "warn" });
    budget.lockBudget("secret123");
    expect(budget.isLocked()).toBe(true);

    budget.unlockBudget();
    expect(budget.isLocked()).toBe(false);
    expect(budget.verifyPassword("anything")).toBe(true);
  });

  it("preserves budget config when locking", () => {
    budget.saveBudget({ daily: 10.0, action: "block" });
    budget.lockBudget("mypass");

    const b = budget.loadBudget();
    expect(b.daily).toBe(10.0);
    expect(b.action).toBe("block");
    expect(b.passwordHash).toBeDefined();
    expect(b.passwordSalt).toBeDefined();
  });

  it("verifyPassword returns true when no lock exists", () => {
    budget.saveBudget({ daily: 5.0, action: "warn" });
    expect(budget.verifyPassword("anything")).toBe(true);
  });

  it("isLocked returns false when budget file does not exist", () => {
    expect(budget.isLocked()).toBe(false);
  });
});

describe("checkBudget", () => {
  it("passes when no daily limit is set", async () => {
    writeBudgetFile({ action: "warn" });
    await expect(budget.checkBudget("posts.create")).resolves.toBeUndefined();
  });

  it("passes when spend is under the limit", async () => {
    writeBudgetFile({ daily: 1.0, action: "block" });
    // No usage entries — well under budget
    await expect(budget.checkBudget("users.getMe")).resolves.toBeUndefined();
  });

  it("throws when action is 'block' and over budget", async () => {
    writeBudgetFile({ daily: 0.001, action: "block" });
    writeUsageLog([
      {
        timestamp: new Date().toISOString(),
        endpoint: "posts.create",
        method: "POST",
        estimatedCost: 0.01,
      },
    ]);

    await expect(budget.checkBudget("posts.create")).rejects.toThrow(
      /budget.*exceeded/i,
    );
  });

  it("warns to stderr when action is 'warn' and over budget", async () => {
    writeBudgetFile({ daily: 0.001, action: "warn" });
    writeUsageLog([
      {
        timestamp: new Date().toISOString(),
        endpoint: "posts.create",
        method: "POST",
        estimatedCost: 0.01,
      },
    ]);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await budget.checkBudget("posts.create");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Warning:"),
    );
    errorSpy.mockRestore();
  });

  it("includes spend details in block error message", async () => {
    writeBudgetFile({ daily: 0.005, action: "block" });
    writeUsageLog([
      {
        timestamp: new Date().toISOString(),
        endpoint: "users.getMe",
        method: "GET",
        estimatedCost: 0.01,
      },
    ]);

    await expect(budget.checkBudget("users.getMe")).rejects.toThrow(
      /\$0\.01/,
    );
  });

  it("passes when spend exactly equals the limit", async () => {
    // daily = 0.015, today spend = 0.01, call cost = 0.005 → total = 0.015 ≤ 0.015
    writeBudgetFile({ daily: 0.015, action: "block" });
    writeUsageLog([
      {
        timestamp: new Date().toISOString(),
        endpoint: "posts.create",
        method: "POST",
        estimatedCost: 0.01,
      },
    ]);

    await expect(budget.checkBudget("users.getMe")).resolves.toBeUndefined();
  });
});
