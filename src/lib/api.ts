import {
  getAccount,
  setAccount,
  type AccountConfig,
  type AuthCredential,
} from "./config.js";
import { refreshAccessToken } from "./oauth.js";

const API_BASE = "https://api.x.com/2";

export class XApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`X API error (${status}): ${JSON.stringify(body)}`);
    this.name = "XApiError";
  }
}

/**
 * Get a valid access token for the account, refreshing if needed.
 */
async function resolveToken(accountName?: string): Promise<string> {
  const account = getAccount(accountName);
  if (!account) {
    throw new Error(
      `No account configured${accountName ? ` (${accountName})` : ""}. Run: xc auth login`,
    );
  }

  const { auth } = account;

  // Bearer token — always valid
  if (auth.type === "bearer") {
    if (!auth.bearerToken) {
      throw new Error("Bearer token is empty. Run: xc auth token <TOKEN>");
    }
    return auth.bearerToken;
  }

  // OAuth 2.0 — check expiry
  if (auth.type === "oauth2") {
    if (!auth.accessToken) {
      throw new Error("No access token. Run: xc auth login");
    }

    // If token is expired (or within 60s of expiry), refresh
    const expiresAt = auth.expiresAt ?? 0;
    if (Date.now() >= expiresAt - 60_000) {
      if (!auth.refreshToken || !auth.clientId) {
        throw new Error("Token expired and no refresh token available. Run: xc auth login");
      }

      console.error("Refreshing access token...");
      const result = await refreshAccessToken({
        clientId: auth.clientId,
        refreshToken: auth.refreshToken,
      });

      // Update stored credentials
      const updatedAuth: AuthCredential = {
        ...auth,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken ?? auth.refreshToken,
        expiresAt: result.expiresAt,
      };
      setAccount(accountName ?? "default", {
        ...account,
        auth: updatedAuth,
      });

      return result.accessToken;
    }

    return auth.accessToken;
  }

  throw new Error(`Unknown auth type: ${auth.type}`);
}

/**
 * Make an authenticated request to the X API.
 */
export async function apiRequest(params: {
  method?: string;
  endpoint: string;
  query?: Record<string, string>;
  body?: unknown;
  account?: string;
}): Promise<unknown> {
  const { method = "GET", endpoint, query, body, account } = params;
  const token = await resolveToken(account);

  const url = new URL(`${API_BASE}${endpoint}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  const fetchOpts: RequestInit = { method, headers };

  if (body) {
    headers["Content-Type"] = "application/json";
    fetchOpts.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), fetchOpts);

  if (!response.ok) {
    const responseBody = await response.json().catch(() => response.text());
    throw new XApiError(response.status, responseBody);
  }

  return response.json();
}
