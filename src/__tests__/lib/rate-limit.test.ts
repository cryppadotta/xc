import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmp: string;
let previousConfigDir: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xc-rate-limit-"));
  previousConfigDir = process.env.XC_CONFIG_DIR;
  process.env.XC_CONFIG_DIR = tmp;
  vi.resetModules();
});
afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.XC_CONFIG_DIR;
  else process.env.XC_CONFIG_DIR = previousConfigDir;
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const response = (status: number, headers: Record<string, string>) => new Response("{}", { status, headers });

describe("durable rate protection", () => {
  it("honors successful response headers before making another request", async () => {
    const { RateLimiter } = await import("../../lib/rate-limit.js");
    let now = 1_000_000;
    const sleep = vi.fn(async (ms: number) => { now += ms; });
    const limiter = new RateLimiter("account", {}, () => now, sleep);
    limiter.observe("GET bookmarks", response(200, { "x-rate-limit-remaining": "0", "x-rate-limit-reset": "1005" }));
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    await limiter.before("GET bookmarks");
    expect(now).toBe(1_006_000);
    expect(sleep).toHaveBeenCalledTimes(6);
    expect(stderr).toHaveBeenCalledTimes(1);
  });

  it("waits for a 429 reset and retries only the rejected request", async () => {
    const { RateLimiter } = await import("../../lib/rate-limit.js");
    let now = 1_000_000;
    const limiter = new RateLimiter("account", {}, () => now, async (ms) => { now += ms; });
    const send = vi.fn().mockResolvedValueOnce(response(429, { "x-rate-limit-reset": "1001" }))
      .mockResolvedValueOnce(response(200, {}));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await limiter.request("GET bookmarks", send)).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    expect(now).toBe(1_002_000);
  });

  it("shares reset state across CLI instances without sharing between accounts/routes", async () => {
    const { RateLimiter } = await import("../../lib/rate-limit.js");
    const now = () => 1_000_000;
    new RateLimiter("alice", {}, now).observe("GET bookmarks", response(429, { "retry-after": "5" }));
    const second = new RateLimiter("alice", { wait: false }, now);
    await expect(second.before("GET bookmarks")).rejects.toMatchObject({ status: 429, retryAt: 1_006_000 });
    await expect(second.before("GET tweets")).resolves.toBeUndefined();
    await expect(new RateLimiter("bob", { wait: false }, now).before("GET bookmarks")).resolves.toBeUndefined();
    const stateFile = path.join(tmp, "rate-limits", fs.readdirSync(path.join(tmp, "rate-limits"))[0]);
    expect(fs.statSync(stateFile).mode & 0o777).toBe(0o600);
  });

  it("honors Retry-After dates and the later of reset/retry headers", async () => {
    const { RateLimiter } = await import("../../lib/rate-limit.js");
    const limiter = new RateLimiter("alice", { wait: false }, () => 1_000_000);
    limiter.observe("GET bookmarks", response(429, {
      "x-rate-limit-reset": "1001", "retry-after": new Date(1_005_000).toUTCString(),
    }));
    await expect(limiter.before("GET bookmarks")).rejects.toMatchObject({ retryAt: 1_006_000 });
  });

  it("does not blindly retry billing/cap failures with no timed reset", async () => {
    const { RateLimiter } = await import("../../lib/rate-limit.js");
    const send = vi.fn().mockResolvedValue(response(429, {}));
    expect((await new RateLimiter("alice").request("GET bookmarks", send)).status).toBe(429);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("bounds retries and declines waits beyond the configured maximum", async () => {
    const { RateLimiter } = await import("../../lib/rate-limit.js");
    let now = 1_000_000;
    const limiter = new RateLimiter("alice", { maxRetries: 1 }, () => now, async (ms) => { now += ms; });
    const send = vi.fn(async () => response(429, { "retry-after": "1" }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await limiter.request("GET bookmarks", send)).status).toBe(429);
    expect(send).toHaveBeenCalledTimes(2);
    await expect(new RateLimiter("alice", { maxWaitMs: 500 }, () => now).before("GET bookmarks"))
      .rejects.toMatchObject({ status: 429 });
  });

  it("does not replay network errors or unrelated HTTP failures", async () => {
    const { RateLimiter } = await import("../../lib/rate-limit.js");
    const limiter = new RateLimiter("alice");
    const failed = vi.fn().mockRejectedValue(new Error("connection lost"));
    await expect(limiter.request("POST tweets", failed)).rejects.toThrow("connection lost");
    expect(failed).toHaveBeenCalledTimes(1);
    const forbidden = vi.fn().mockResolvedValue(response(403, {}));
    expect((await limiter.request("GET bookmarks", forbidden)).status).toBe(403);
    expect(forbidden).toHaveBeenCalledTimes(1);
  });

  it("protects the real SDK transport without replacing its shared HTTP client", async () => {
    const { Client } = await import("@xdevplatform/xdk");
    const { protectClient } = await import("../../lib/rate-limit.js");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(200, {
      "content-type": "application/json", "x-rate-limit-remaining": "0",
      "x-rate-limit-reset": String(Math.floor(Date.now() / 1000) + 900),
    }));
    const original = new Client({ accessToken: "test" });
    const protectedClient = protectClient(new Client({ accessToken: "test" }), "alice", { wait: false });
    expect(original.httpClient).not.toBe(protectedClient.httpClient);
    await protectedClient.users.getBookmarks("123", { maxResults: 10 });
    await expect(protectedClient.users.getBookmarks("123", { maxResults: 10 })).rejects.toThrow("Rate limit");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not sleep when the caller has aborted", async () => {
    const { RateLimiter } = await import("../../lib/rate-limit.js");
    const controller = new AbortController(); controller.abort();
    const send = vi.fn();
    await expect(new RateLimiter("alice").request("GET bookmarks", send, controller.signal)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
