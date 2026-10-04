import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client, HttpClient } from "@xdevplatform/xdk";
import { getConfigDir } from "./config.js";

export interface RateLimitOptions {
  wait?: boolean;
  maxWaitMs?: number;
  maxRetries?: number;
}

export class RateLimitError extends Error {
  readonly status = 429;
  constructor(readonly retryAt: number, readonly endpoint: string) {
    super(`Rate limit for ${endpoint}; retry after ${new Date(retryAt).toISOString()}. Progress is saved.`);
  }
}

interface LimitState {
  remaining?: number;
  resetAt: number;
}

/** One durable bucket per account and route, shared by successive CLI runs. */
export class RateLimiter {
  constructor(
    private readonly scope: string,
    private readonly options: RateLimitOptions = {},
    private readonly now = Date.now,
    private readonly sleep: (ms: number) => Promise<unknown> = delay,
  ) {}

  private file(endpoint: string): string {
    const key = crypto.createHash("sha256").update(`${this.scope}:${endpoint}`).digest("hex");
    return path.join(getConfigDir(), "rate-limits", `${key}.json`);
  }

  private read(endpoint: string): LimitState | undefined {
    try {
      return JSON.parse(fs.readFileSync(this.file(endpoint), "utf8")) as LimitState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  observe(endpoint: string, response: Pick<Response, "headers" | "status">): void {
    const reset = Number(response.headers.get("x-rate-limit-reset")) * 1000;
    const remainingHeader = response.headers.get("x-rate-limit-remaining");
    const remaining = remainingHeader === null ? undefined : Number(remainingHeader);
    const retryAfter = response.headers.get("retry-after");
    const retryAt = retryAfter === null ? 0 : /^\d+(\.\d+)?$/.test(retryAfter)
      ? this.now() + Number(retryAfter) * 1000
      : Date.parse(retryAfter);
    const resetAt = Math.max(Number.isFinite(reset) ? reset : 0, Number.isFinite(retryAt) ? retryAt : 0);
    // No timed reset usually means a billing/cap error: do not blindly retry it.
    if (resetAt <= this.now()) return;
    const state: LimitState = {
      remaining: response.status === 429 ? 0 : remaining,
      resetAt: resetAt + 1000, // allow for server/client clock boundaries
    };
    const file = this.file(endpoint);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  async before(endpoint: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const state = this.read(endpoint);
    if (!state || state.remaining !== 0 || state.resetAt <= this.now()) return;
    const waitMs = state.resetAt - this.now();
    if (this.options.wait === false || waitMs > (this.options.maxWaitMs ?? 20 * 60_000)) {
      throw new RateLimitError(state.resetAt, endpoint);
    }
    console.error(`Rate limit for ${endpoint}; waiting ${Math.ceil(waitMs / 1000)}s until ${new Date(state.resetAt).toISOString()}.`);
    // Short chunks allow cancellation even when the window is several minutes.
    while (state.resetAt > this.now()) {
      signal?.throwIfAborted();
      await this.sleep(Math.min(1000, state.resetAt - this.now()));
    }
  }

  async request<T extends Pick<Response, "status" | "headers"> & { body?: { cancel(): Promise<unknown> } | null }>(
    endpoint: string,
    send: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.before(endpoint, signal);
      const response = await send();
      this.observe(endpoint, response);
      if (response.status !== 429 || attempt >= (this.options.maxRetries ?? 2)) return response;
      const state = this.read(endpoint);
      if (!state || state.resetAt <= this.now() || state.remaining !== 0) return response;
      // Consume the failed body before reusing the connection or waiting.
      await response.body?.cancel();
    }
  }
}

/** Install on this client only; the SDK otherwise shares a global transport. */
export function protectClient(client: Client, scope: string, options?: RateLimitOptions): Client {
  const transport = new HttpClient();
  const send = transport.request.bind(transport);
  const limiter = new RateLimiter(scope, options);
  transport.request = (url, requestOptions = {}) => {
    const pathname = new URL(url).pathname.replace(/\/\d+(?=\/|$)/g,
      (segment, offset: number) => offset === 0 ? segment : "/:id");
    const endpoint = `${requestOptions.method ?? "GET"} ${pathname}`;
    return limiter.request(endpoint, () => send(url, requestOptions), requestOptions.signal ?? undefined);
  };
  Object.defineProperty(client, "httpClient", { value: transport });
  return client;
}

export function rateLimitRetryAt(error: unknown): number | null | undefined {
  if (error instanceof RateLimitError) return error.retryAt;
  const value = error as { status?: number; headers?: Headers; data?: unknown } | undefined;
  if (value?.data instanceof RateLimitError) return value.data.retryAt;
  if (value?.status !== 429) return undefined;
  const reset = Number(value.headers?.get("x-rate-limit-reset")) * 1000;
  return reset > Date.now() ? reset + 1000 : null;
}
