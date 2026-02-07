/**
 * Tests for API cost tracking: estimateCost, inferMethod,
 * logApiCall/loadUsageLog, computeSpend, formatCostFooter.
 * Uses vi.resetModules() + dynamic import for filesystem isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** Shape of the dynamically imported cost module. */
type CostModule = typeof import("../../lib/cost.js");

let tmpDir: string;
let origConfigDir: string | undefined;
let cost: CostModule;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xc-cost-test-"));
  origConfigDir = process.env.XC_CONFIG_DIR;
  process.env.XC_CONFIG_DIR = tmpDir;

  vi.resetModules();
  cost = await import("../../lib/cost.js");
});

afterEach(() => {
  if (origConfigDir !== undefined) {
    process.env.XC_CONFIG_DIR = origConfigDir;
  } else {
    delete process.env.XC_CONFIG_DIR;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("estimateCost", () => {
  it("returns known cost for mapped endpoints", () => {
    expect(cost.estimateCost("posts.create")).toBe(0.01);
    expect(cost.estimateCost("posts.searchAll")).toBe(0.02);
    expect(cost.estimateCost("users.getMe")).toBe(0.005);
  });

  it("returns default cost for unknown endpoints", () => {
    expect(cost.estimateCost("unknown.endpoint")).toBe(0.005);
  });

  it("returns zero cost for free endpoints", () => {
    expect(cost.estimateCost("media.appendUpload")).toBe(0.0);
    expect(cost.estimateCost("media.getUploadStatus")).toBe(0.0);
    expect(cost.estimateCost("usage.get")).toBe(0.0);
  });
});

describe("inferMethod", () => {
  it("returns POST for write endpoints", () => {
    expect(cost.inferMethod("posts.create")).toBe("POST");
    expect(cost.inferMethod("users.likePost")).toBe("POST");
    expect(cost.inferMethod("media.upload")).toBe("POST");
  });

  it("returns DELETE for removal endpoints", () => {
    expect(cost.inferMethod("users.unlikePost")).toBe("DELETE");
    expect(cost.inferMethod("users.deleteBookmark")).toBe("DELETE");
    expect(cost.inferMethod("users.unfollowUser")).toBe("DELETE");
  });

  it("defaults to GET for unmapped endpoints", () => {
    expect(cost.inferMethod("users.getMe")).toBe("GET");
    expect(cost.inferMethod("posts.searchRecent")).toBe("GET");
    expect(cost.inferMethod("unknown.endpoint")).toBe("GET");
  });
});

describe("logApiCall / loadUsageLog", () => {
  it("returns empty array when no log file exists", () => {
    expect(cost.loadUsageLog()).toEqual([]);
  });

  it("appends a single entry to JSONL file", () => {
    cost.logApiCall("posts.create");

    const entries = cost.loadUsageLog();
    expect(entries).toHaveLength(1);
    expect(entries[0].endpoint).toBe("posts.create");
    expect(entries[0].method).toBe("POST");
    expect(entries[0].estimatedCost).toBe(0.01);
    expect(entries[0].timestamp).toBeDefined();
  });

  it("appends multiple entries in order", () => {
    cost.logApiCall("users.getMe");
    cost.logApiCall("posts.create");
    cost.logApiCall("users.likePost");

    const entries = cost.loadUsageLog();
    expect(entries).toHaveLength(3);
    expect(entries[0].endpoint).toBe("users.getMe");
    expect(entries[1].endpoint).toBe("posts.create");
    expect(entries[2].endpoint).toBe("users.likePost");
  });

  it("skips malformed JSON lines", () => {
    const logPath = cost.getUsageLogPath();
    fs.writeFileSync(
      logPath,
      '{"timestamp":"2025-01-01T00:00:00Z","endpoint":"a","method":"GET","estimatedCost":0.01}\n' +
        "not-valid-json\n" +
        '{"timestamp":"2025-01-01T00:00:01Z","endpoint":"b","method":"GET","estimatedCost":0.02}\n',
    );

    const entries = cost.loadUsageLog();
    expect(entries).toHaveLength(2);
    expect(entries[0].endpoint).toBe("a");
    expect(entries[1].endpoint).toBe("b");
  });

  it("returns empty array for empty file", () => {
    const logPath = cost.getUsageLogPath();
    fs.writeFileSync(logPath, "");

    expect(cost.loadUsageLog()).toEqual([]);
  });
});

describe("computeSpend", () => {
  it("sums entries within the time window", () => {
    const now = Date.now();
    const entries = [
      { timestamp: new Date(now - 1_000).toISOString(), endpoint: "a", method: "GET", estimatedCost: 0.01 },
      { timestamp: new Date(now - 2_000).toISOString(), endpoint: "b", method: "GET", estimatedCost: 0.02 },
      { timestamp: new Date(now - 100_000).toISOString(), endpoint: "c", method: "GET", estimatedCost: 0.05 },
    ];

    // 10-second window should include only the first two entries
    const spend = cost.computeSpend(entries, 10_000);
    expect(spend).toBeCloseTo(0.03);
  });

  it("returns 0 for empty entries", () => {
    expect(cost.computeSpend([], cost.HOUR)).toBe(0);
  });

  it("excludes all entries when outside the window", () => {
    const entries = [
      { timestamp: new Date(Date.now() - 200_000).toISOString(), endpoint: "a", method: "GET", estimatedCost: 0.10 },
    ];
    expect(cost.computeSpend(entries, 1_000)).toBe(0);
  });

  it("includes all entries when window is large enough", () => {
    const now = Date.now();
    const entries = [
      { timestamp: new Date(now - 1_000).toISOString(), endpoint: "a", method: "GET", estimatedCost: 0.01 },
      { timestamp: new Date(now - 5_000).toISOString(), endpoint: "b", method: "GET", estimatedCost: 0.02 },
    ];
    const spend = cost.computeSpend(entries, cost.HOUR);
    expect(spend).toBeCloseTo(0.03);
  });
});

describe("computeTodaySpend", () => {
  it("sums entries from today", () => {
    const now = new Date();
    const entries = [
      { timestamp: now.toISOString(), endpoint: "a", method: "GET", estimatedCost: 0.01 },
      { timestamp: now.toISOString(), endpoint: "b", method: "POST", estimatedCost: 0.02 },
    ];
    expect(cost.computeTodaySpend(entries)).toBeCloseTo(0.03);
  });

  it("excludes entries from yesterday", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59, 999);

    const entries = [
      { timestamp: yesterday.toISOString(), endpoint: "a", method: "GET", estimatedCost: 0.50 },
    ];
    expect(cost.computeTodaySpend(entries)).toBe(0);
  });

  it("returns 0 for empty entries", () => {
    expect(cost.computeTodaySpend([])).toBe(0);
  });
});

describe("time constants", () => {
  it("has correct values", () => {
    expect(cost.HOUR).toBe(3_600_000);
    expect(cost.DAY).toBe(86_400_000);
    expect(cost.WEEK).toBe(7 * 86_400_000);
    expect(cost.MONTH).toBe(30 * 86_400_000);
  });
});

describe("formatCostFooter", () => {
  it("returns empty string when no usage recorded", () => {
    expect(cost.formatCostFooter()).toBe("");
  });

  it("formats cost breakdown by time windows", () => {
    cost.logApiCall("posts.create");
    cost.logApiCall("users.getMe");

    const footer = cost.formatCostFooter();
    expect(footer).toContain("Cost:");
    expect(footer).toContain("(1h)");
    expect(footer).toContain("(24h)");
    expect(footer).toContain("(7d)");
    expect(footer).toContain("(30d)");
    expect(footer).toContain("$");
  });
});
