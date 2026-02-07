/**
 * Tests for API client creation, token resolution, and auto-refresh.
 * Mocks all external dependencies (config, oauth, cost, budget, XDK).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all lib dependencies
vi.mock("../../lib/config.js", () => ({
  getAccount: vi.fn(),
  setAccount: vi.fn(),
}));

vi.mock("../../lib/oauth.js", () => ({
  refreshAccessToken: vi.fn(),
}));

vi.mock("../../lib/cost.js", () => ({
  logApiCall: vi.fn(),
  estimateCost: vi.fn(() => 0),
}));

vi.mock("../../lib/budget.js", () => ({
  checkBudget: vi.fn(),
}));

// Mock the XDK Client constructor — return a plain object with stub namespaces
vi.mock("@xdevplatform/xdk", () => ({
  Client: vi.fn().mockImplementation((opts: Record<string, unknown>) => ({
    _opts: opts,
    posts: {
      searchRecent: vi.fn().mockResolvedValue({ data: [] }),
    },
    users: {
      getMe: vi.fn().mockResolvedValue({ data: { id: "u1" } }),
    },
  })),
}));

import { getAccount, setAccount } from "../../lib/config.js";
import { refreshAccessToken } from "../../lib/oauth.js";
import { logApiCall } from "../../lib/cost.js";
import { checkBudget } from "../../lib/budget.js";
import { Client } from "@xdevplatform/xdk";
import { getClient } from "../../lib/api.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getClient", () => {
  it("throws when no account is configured", async () => {
    vi.mocked(getAccount).mockReturnValue(undefined);
    await expect(getClient()).rejects.toThrow(/No account configured/);
  });

  it("includes account name in error when specified", async () => {
    vi.mocked(getAccount).mockReturnValue(undefined);
    await expect(getClient("myaccount")).rejects.toThrow("(myaccount)");
  });

  it("creates a bearer-token client", async () => {
    vi.mocked(getAccount).mockReturnValue({
      name: "test",
      auth: { type: "bearer", bearerToken: "mytoken123" },
    });

    const client = await getClient();
    expect(Client).toHaveBeenCalledWith({ bearerToken: "mytoken123" });
    expect(client).toBeDefined();
  });

  it("throws when bearer token is empty", async () => {
    vi.mocked(getAccount).mockReturnValue({
      name: "test",
      auth: { type: "bearer" },
    });
    await expect(getClient()).rejects.toThrow(/Bearer token is empty/);
  });

  it("creates OAuth2 client with valid (non-expired) token", async () => {
    vi.mocked(getAccount).mockReturnValue({
      name: "test",
      auth: {
        type: "oauth2",
        accessToken: "access123",
        refreshToken: "refresh123",
        clientId: "client123",
        expiresAt: Date.now() + 600_000,
      },
    });

    const client = await getClient();
    expect(Client).toHaveBeenCalledWith({ accessToken: "access123" });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes an expired OAuth2 token", async () => {
    vi.mocked(getAccount).mockReturnValue({
      name: "test",
      auth: {
        type: "oauth2",
        accessToken: "old-access",
        refreshToken: "refresh123",
        clientId: "client123",
        expiresAt: Date.now() - 1_000,
      },
    });

    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: Date.now() + 7_200_000,
      scopes: "tweet.read",
    });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = await getClient();
    errSpy.mockRestore();

    expect(refreshAccessToken).toHaveBeenCalledWith({
      clientId: "client123",
      refreshToken: "refresh123",
    });
    expect(Client).toHaveBeenCalledWith({ accessToken: "new-access" });
    expect(setAccount).toHaveBeenCalled();
  });

  it("refreshes token within 60s of expiry", async () => {
    vi.mocked(getAccount).mockReturnValue({
      name: "test",
      auth: {
        type: "oauth2",
        accessToken: "expiring-soon",
        refreshToken: "refresh123",
        clientId: "client123",
        expiresAt: Date.now() + 30_000, // 30s from now, within 60s window
      },
    });

    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: "refreshed",
      refreshToken: "new-refresh",
      expiresAt: Date.now() + 7_200_000,
      scopes: "",
    });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await getClient();
    errSpy.mockRestore();

    expect(refreshAccessToken).toHaveBeenCalled();
  });

  it("throws when OAuth2 token expired with no refresh token", async () => {
    vi.mocked(getAccount).mockReturnValue({
      name: "test",
      auth: {
        type: "oauth2",
        accessToken: "old",
        expiresAt: Date.now() - 1_000,
      },
    });
    await expect(getClient()).rejects.toThrow(/no refresh token/);
  });

  it("throws when no access token for OAuth2", async () => {
    vi.mocked(getAccount).mockReturnValue({
      name: "test",
      auth: { type: "oauth2" },
    });
    await expect(getClient()).rejects.toThrow(/No access token/);
  });

  it("throws for unknown auth type", async () => {
    vi.mocked(getAccount).mockReturnValue({
      name: "test",
      auth: { type: "unknown" as any },
    });
    await expect(getClient()).rejects.toThrow(/Unknown auth type/);
  });

  it("defaults expiresAt to 0 when undefined", async () => {
    // expiresAt undefined → treated as 0, which means expired
    vi.mocked(getAccount).mockReturnValue({
      name: "test",
      auth: {
        type: "oauth2",
        accessToken: "tok",
        refreshToken: "rt",
        clientId: "cid",
        // expiresAt intentionally omitted
      },
    });

    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: "new",
      refreshToken: "new-rt",
      expiresAt: Date.now() + 7_200_000,
      scopes: "",
    });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await getClient();
    errSpy.mockRestore();

    // Should trigger refresh since expiresAt defaults to 0
    expect(refreshAccessToken).toHaveBeenCalled();
  });
});

describe("wrapped client proxy", () => {
  it("checks budget and logs API calls on method invocation", async () => {
    vi.mocked(getAccount).mockReturnValue({
      name: "test",
      auth: { type: "bearer", bearerToken: "tok" },
    });

    const client = await getClient();
    await client.posts.searchRecent({} as any);

    expect(checkBudget).toHaveBeenCalledWith("posts.searchRecent");
    expect(logApiCall).toHaveBeenCalledWith("posts.searchRecent");
  });

  it("forwards arguments to the underlying SDK method", async () => {
    vi.mocked(getAccount).mockReturnValue({
      name: "test",
      auth: { type: "bearer", bearerToken: "tok" },
    });

    const client = await getClient();
    const result = await client.users.getMe({ userFields: ["id"] } as any);

    expect(result).toEqual({ data: { id: "u1" } });
  });
});
