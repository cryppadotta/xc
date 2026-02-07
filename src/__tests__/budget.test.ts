/**
 * Tests for budget lib: password locking, hashing, verification.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadBudget,
  saveBudget,
  resetBudget,
  hashPassword,
  isLocked,
  verifyPassword,
  lockBudget,
  unlockBudget,
  getBudgetPath,
} from "../lib/budget.js";

// Use a temp dir for tests so we don't touch real config
let origConfigDir: string | undefined;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xc-budget-test-"));
  origConfigDir = process.env.XC_CONFIG_DIR;
  process.env.XC_CONFIG_DIR = tmpDir;
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
    const budget = loadBudget();
    expect(budget.action).toBe("warn");
    expect(budget.daily).toBeUndefined();
  });

  it("saves and loads budget config", () => {
    saveBudget({ daily: 5.0, action: "block" });
    const budget = loadBudget();
    expect(budget.daily).toBe(5.0);
    expect(budget.action).toBe("block");
  });

  it("resets budget by removing file", () => {
    saveBudget({ daily: 5.0, action: "warn" });
    expect(fs.existsSync(getBudgetPath())).toBe(true);
    resetBudget();
    expect(fs.existsSync(getBudgetPath())).toBe(false);
  });
});

describe("password hashing", () => {
  it("produces consistent hashes with same salt", () => {
    const salt = "abcdef1234567890";
    const h1 = hashPassword("mypassword", salt);
    const h2 = hashPassword("mypassword", salt);
    expect(h1).toBe(h2);
  });

  it("produces different hashes with different salts", () => {
    const h1 = hashPassword("mypassword", "salt1");
    const h2 = hashPassword("mypassword", "salt2");
    expect(h1).not.toBe(h2);
  });

  it("produces different hashes for different passwords", () => {
    const salt = "samesalt";
    const h1 = hashPassword("password1", salt);
    const h2 = hashPassword("password2", salt);
    expect(h1).not.toBe(h2);
  });
});

describe("budget locking", () => {
  it("reports unlocked when no password set", () => {
    saveBudget({ daily: 5.0, action: "warn" });
    expect(isLocked()).toBe(false);
  });

  it("locks budget with password", () => {
    saveBudget({ daily: 5.0, action: "warn" });
    lockBudget("secret123");
    expect(isLocked()).toBe(true);
  });

  it("verifies correct password", () => {
    saveBudget({ daily: 5.0, action: "warn" });
    lockBudget("secret123");
    expect(verifyPassword("secret123")).toBe(true);
  });

  it("rejects incorrect password", () => {
    saveBudget({ daily: 5.0, action: "warn" });
    lockBudget("secret123");
    expect(verifyPassword("wrong")).toBe(false);
  });

  it("unlocks budget and removes password", () => {
    saveBudget({ daily: 5.0, action: "warn" });
    lockBudget("secret123");
    expect(isLocked()).toBe(true);

    unlockBudget();
    expect(isLocked()).toBe(false);
    expect(verifyPassword("anything")).toBe(true);
  });

  it("preserves budget config when locking", () => {
    saveBudget({ daily: 10.0, action: "block" });
    lockBudget("mypass");

    const budget = loadBudget();
    expect(budget.daily).toBe(10.0);
    expect(budget.action).toBe("block");
    expect(budget.passwordHash).toBeDefined();
    expect(budget.passwordSalt).toBeDefined();
  });
});
