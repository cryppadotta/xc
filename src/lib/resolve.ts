/** Helpers for resolving user IDs from config cache or API. */

import { apiRequest } from "./api.js";
import { getAccount, loadConfig, saveConfig } from "./config.js";

/**
 * Get the authenticated user's ID, using cached value or fetching via /users/me.
 */
export async function resolveAuthenticatedUserId(
  accountName?: string,
): Promise<string> {
  const account = getAccount(accountName);
  if (account?.userId) {
    return account.userId;
  }

  // Fetch from API and cache
  const result = (await apiRequest({
    endpoint: "/users/me",
    query: { "user.fields": "id" },
    account: accountName,
  })) as { data: { id: string; username: string } };

  if (account) {
    const config = loadConfig();
    const name = accountName ?? config.defaultAccount;
    const stored = config.accounts[name];
    if (stored) {
      stored.userId = result.data.id;
      stored.username = result.data.username;
      saveConfig(config);
    }
  }

  return result.data.id;
}

/**
 * Resolve a @username to a user ID via the API.
 */
export async function resolveUserId(
  username: string,
  accountName?: string,
): Promise<string> {
  const clean = username.replace(/^@/, "");

  const result = (await apiRequest({
    endpoint: `/users/by/username/${encodeURIComponent(clean)}`,
    account: accountName,
  })) as { data: { id: string } };

  return result.data.id;
}
