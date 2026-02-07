/**
 * Tests for config management: load/save, accounts, migration.
 * Uses vi.resetModules() + dynamic import so the module-level
 * CONFIG_DIR constant picks up process.env.XC_CONFIG_DIR from each test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** Shape of the dynamically imported config module. */
type ConfigModule = typeof import("../../lib/config.js");

let tmpDir: string;
let legacyDir: string;
let origConfigDir: string | undefined;
let origXdgHome: string | undefined;
let config: ConfigModule;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xc-config-test-"));
  legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "xc-legacy-test-"));

  origConfigDir = process.env.XC_CONFIG_DIR;
  origXdgHome = process.env.XDG_CONFIG_HOME;

  process.env.XC_CONFIG_DIR = tmpDir;
  process.env.XDG_CONFIG_HOME = legacyDir;

  // Re-import so module-level constants re-evaluate with new env vars
  vi.resetModules();
  config = await import("../../lib/config.js");
});

afterEach(() => {
  if (origConfigDir !== undefined) {
    process.env.XC_CONFIG_DIR = origConfigDir;
  } else {
    delete process.env.XC_CONFIG_DIR;
  }
  if (origXdgHome !== undefined) {
    process.env.XDG_CONFIG_HOME = origXdgHome;
  } else {
    delete process.env.XDG_CONFIG_HOME;
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(legacyDir, { recursive: true, force: true });
});

describe("getConfigDir / getConfigPath", () => {
  it("returns the XC_CONFIG_DIR path", () => {
    expect(config.getConfigDir()).toBe(tmpDir);
  });

  it("config path is config.json inside config dir", () => {
    expect(config.getConfigPath()).toBe(path.join(tmpDir, "config.json"));
  });
});

describe("ensureConfigDir", () => {
  it("creates the config directory", () => {
    // tmpDir already exists from mkdtempSync, remove it to test creation
    fs.rmSync(tmpDir, { recursive: true, force: true });
    expect(fs.existsSync(tmpDir)).toBe(false);

    config.ensureConfigDir();
    expect(fs.existsSync(tmpDir)).toBe(true);
  });

  it("is idempotent when directory already exists", () => {
    config.ensureConfigDir();
    config.ensureConfigDir();
    expect(fs.existsSync(config.getConfigDir())).toBe(true);
  });
});

describe("loadConfig / saveConfig", () => {
  it("returns defaults when no config file exists", () => {
    const cfg = config.loadConfig();
    expect(cfg.defaultAccount).toBe("default");
    expect(cfg.accounts).toEqual({});
  });

  it("saves and loads config roundtrip", () => {
    const testConfig = {
      defaultAccount: "myaccount",
      accounts: {
        myaccount: {
          name: "myaccount",
          auth: { type: "bearer" as const, bearerToken: "tok123" },
        },
      },
    };
    config.saveConfig(testConfig);
    const loaded = config.loadConfig();
    expect(loaded.defaultAccount).toBe("myaccount");
    expect(loaded.accounts.myaccount.auth.bearerToken).toBe("tok123");
  });

  it("writes valid JSON with trailing newline", () => {
    config.saveConfig({ defaultAccount: "test", accounts: {} });
    const raw = fs.readFileSync(config.getConfigPath(), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("creates config dir when saving if it doesn't exist", () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    config.saveConfig({ defaultAccount: "test", accounts: {} });
    expect(fs.existsSync(config.getConfigPath())).toBe(true);
  });
});

describe("getAccount", () => {
  it("returns undefined when no accounts exist", () => {
    expect(config.getAccount("nonexistent")).toBeUndefined();
  });

  it("returns account by name", () => {
    config.saveConfig({
      defaultAccount: "default",
      accounts: {
        myaccount: {
          name: "myaccount",
          auth: { type: "bearer", bearerToken: "tok" },
        },
      },
    });
    const account = config.getAccount("myaccount");
    expect(account).toBeDefined();
    expect(account!.name).toBe("myaccount");
  });

  it("returns default account when no name specified", () => {
    config.saveConfig({
      defaultAccount: "primary",
      accounts: {
        primary: {
          name: "primary",
          auth: { type: "bearer", bearerToken: "tok1" },
        },
        secondary: {
          name: "secondary",
          auth: { type: "bearer", bearerToken: "tok2" },
        },
      },
    });
    const account = config.getAccount();
    expect(account?.name).toBe("primary");
  });

  it("returns undefined for default account if not in accounts map", () => {
    config.saveConfig({
      defaultAccount: "missing",
      accounts: {},
    });
    expect(config.getAccount()).toBeUndefined();
  });
});

describe("setAccount", () => {
  it("adds a new account to config", () => {
    config.setAccount("new", {
      name: "new",
      auth: { type: "bearer", bearerToken: "newtok" },
    });
    const account = config.getAccount("new");
    expect(account).toBeDefined();
    expect(account!.auth.bearerToken).toBe("newtok");
  });

  it("overwrites an existing account", () => {
    config.setAccount("test", {
      name: "test",
      auth: { type: "bearer", bearerToken: "old" },
    });
    config.setAccount("test", {
      name: "test",
      auth: { type: "bearer", bearerToken: "new" },
    });
    const account = config.getAccount("test");
    expect(account!.auth.bearerToken).toBe("new");
  });

  it("preserves other accounts when adding", () => {
    config.setAccount("a", {
      name: "a",
      auth: { type: "bearer", bearerToken: "tokA" },
    });
    config.setAccount("b", {
      name: "b",
      auth: { type: "bearer", bearerToken: "tokB" },
    });
    expect(config.getAccount("a")?.auth.bearerToken).toBe("tokA");
    expect(config.getAccount("b")?.auth.bearerToken).toBe("tokB");
  });
});

describe("setDefaultAccount", () => {
  it("changes the default account name", () => {
    config.saveConfig({ defaultAccount: "old", accounts: {} });
    config.setDefaultAccount("new");
    const cfg = config.loadConfig();
    expect(cfg.defaultAccount).toBe("new");
  });
});

describe("config migration", () => {
  it("migrates from legacy config dir when new config absent", async () => {
    // Set up legacy config at $XDG_CONFIG_HOME/xc/config.json
    const legacyXcDir = path.join(legacyDir, "xc");
    fs.mkdirSync(legacyXcDir, { recursive: true });
    const legacyConfig = {
      defaultAccount: "migrated",
      accounts: {
        migrated: {
          name: "migrated",
          auth: { type: "bearer", bearerToken: "legacytoken" },
        },
      },
    };
    fs.writeFileSync(
      path.join(legacyXcDir, "config.json"),
      JSON.stringify(legacyConfig),
    );

    // Remove new config file so migration triggers
    const newConfigPath = config.getConfigPath();
    if (fs.existsSync(newConfigPath)) {
      fs.unlinkSync(newConfigPath);
    }

    // Re-import to get a fresh module that will trigger migration on loadConfig
    vi.resetModules();
    const freshConfig: ConfigModule = await import("../../lib/config.js");

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const loaded = freshConfig.loadConfig();
    errSpy.mockRestore();

    expect(loaded.defaultAccount).toBe("migrated");
    expect(loaded.accounts.migrated.auth.bearerToken).toBe("legacytoken");
    // New config file should now exist
    expect(fs.existsSync(freshConfig.getConfigPath())).toBe(true);
  });

  it("does not migrate when new config already exists", async () => {
    // Create legacy config
    const legacyXcDir = path.join(legacyDir, "xc");
    fs.mkdirSync(legacyXcDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyXcDir, "config.json"),
      JSON.stringify({ defaultAccount: "legacy", accounts: {} }),
    );

    // Create new config that should NOT be overwritten
    config.saveConfig({ defaultAccount: "new", accounts: {} });

    // Re-import — migration should not trigger
    vi.resetModules();
    const freshConfig: ConfigModule = await import("../../lib/config.js");

    const loaded = freshConfig.loadConfig();
    expect(loaded.defaultAccount).toBe("new");
  });
});
