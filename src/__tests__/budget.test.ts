/**
 * Tests for budget lib: password locking, hashing, verification.
 * Uses vi.resetModules() + dynamic import so the config module's
 * CONFIG_DIR constant picks up the temp dir from process.env.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

type BudgetModule = typeof import("../lib/budget.js");

let origConfigDir: string | undefined;
let tmpDir: string;
let budget: BudgetModule;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xc-budget-test-"));
  origConfigDir = process.env.XC_CONFIG_DIR;
  process.env.XC_CONFIG_DIR = tmpDir;

  vi.resetModules();
  budget = await import("../lib/budget.js");
});

afterEach(() => {
  if (origConfigDir !== undefined) {
    process.env.XC_CONFIG_DIR = origConfigDir;
  } else {
    delete process.env.XC_CONFIG_DIR;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

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

  it("unlocks budget and removes password", () => {
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
});
