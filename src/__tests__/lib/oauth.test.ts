/**
 * Tests for OAuth 2.0 PKCE flow configuration and token refresh.
 * Mocks the XDK OAuth2 class and generateCodeVerifier.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Set up mock functions before vi.mock so the factory can reference them
const mockRefreshToken = vi.fn();
const mockSetPkceParameters = vi.fn();
const mockGetAuthorizationUrl = vi.fn();
const mockExchangeCode = vi.fn();

vi.mock("@xdevplatform/xdk", () => ({
  OAuth2: vi.fn().mockImplementation(() => ({
    setPkceParameters: mockSetPkceParameters,
    getAuthorizationUrl: mockGetAuthorizationUrl,
    exchangeCode: mockExchangeCode,
    refreshToken: mockRefreshToken,
  })),
  generateCodeVerifier: vi.fn(() => "test-code-verifier-string"),
}));

import { OAuth2, generateCodeVerifier } from "@xdevplatform/xdk";
import { refreshAccessToken } from "../../lib/oauth.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("refreshAccessToken", () => {
  it("creates OAuth2 instance with correct config", async () => {
    mockRefreshToken.mockResolvedValue({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 7200,
      scope: "tweet.read tweet.write",
    });

    await refreshAccessToken({
      clientId: "my-client-id",
      refreshToken: "old-refresh",
    });

    expect(OAuth2).toHaveBeenCalledWith({
      clientId: "my-client-id",
      redirectUri: "http://127.0.0.1:3391/callback",
    });
  });

  it("calls SDK refreshToken with provided refresh token", async () => {
    mockRefreshToken.mockResolvedValue({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 7200,
      scope: "",
    });

    await refreshAccessToken({
      clientId: "cid",
      refreshToken: "my-refresh-token",
    });

    expect(mockRefreshToken).toHaveBeenCalledWith("my-refresh-token");
  });

  it("returns formatted OAuthFlowResult", async () => {
    const now = Date.now();
    mockRefreshToken.mockResolvedValue({
      access_token: "fresh-access",
      refresh_token: "fresh-refresh",
      expires_in: 3600,
      scope: "tweet.read",
    });

    const result = await refreshAccessToken({
      clientId: "cid",
      refreshToken: "rt",
    });

    expect(result.accessToken).toBe("fresh-access");
    expect(result.refreshToken).toBe("fresh-refresh");
    expect(result.expiresAt).toBeGreaterThan(now);
    expect(result.expiresAt).toBeLessThanOrEqual(now + 3600 * 1000 + 100);
    expect(result.scopes).toBe("tweet.read");
  });

  it("keeps original refresh token if response omits it", async () => {
    mockRefreshToken.mockResolvedValue({
      access_token: "new-access",
      expires_in: 7200,
      // No refresh_token in response
    });

    const result = await refreshAccessToken({
      clientId: "cid",
      refreshToken: "original-refresh",
    });

    expect(result.refreshToken).toBe("original-refresh");
  });

  it("handles empty/missing scope gracefully", async () => {
    mockRefreshToken.mockResolvedValue({
      access_token: "tok",
      expires_in: 3600,
      // No scope field
    });

    const result = await refreshAccessToken({
      clientId: "cid",
      refreshToken: "rt",
    });

    expect(result.scopes).toBe("");
  });

  it("calculates expiresAt from expires_in", async () => {
    const before = Date.now();
    mockRefreshToken.mockResolvedValue({
      access_token: "tok",
      refresh_token: "rt",
      expires_in: 7200,
      scope: "",
    });

    const result = await refreshAccessToken({
      clientId: "cid",
      refreshToken: "rt",
    });
    const after = Date.now();

    // expiresAt should be approximately now + 7200s
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 7200 * 1000);
    expect(result.expiresAt).toBeLessThanOrEqual(after + 7200 * 1000);
  });
});

describe("generateCodeVerifier", () => {
  it("is available from SDK and returns a string", () => {
    const verifier = generateCodeVerifier();
    expect(typeof verifier).toBe("string");
    expect(verifier).toBe("test-code-verifier-string");
    expect(generateCodeVerifier).toHaveBeenCalled();
  });
});
