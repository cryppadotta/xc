import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface AuthCredential {
  type: "oauth2" | "bearer";
  /** OAuth 2.0 access token */
  accessToken?: string;
  /** OAuth 2.0 refresh token */
  refreshToken?: string;
  /** Token expiry (epoch ms) */
  expiresAt?: number;
  /** App-only bearer token */
  bearerToken?: string;
  /** OAuth 2.0 client ID */
  clientId?: string;
}

export interface AccountConfig {
  name: string;
  auth: AuthCredential;
  userId?: string;
  username?: string;
}

export interface XcConfig {
  defaultAccount: string;
  accounts: Record<string, AccountConfig>;
}

const CONFIG_DIR =
  process.env.XC_CONFIG_DIR ??
  path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "xc");

const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function ensureConfigDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

export function loadConfig(): XcConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { defaultAccount: "default", accounts: {} };
  }
  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  return JSON.parse(raw) as XcConfig;
}

export function saveConfig(config: XcConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function getAccount(name?: string): AccountConfig | undefined {
  const config = loadConfig();
  const accountName = name ?? config.defaultAccount;
  return config.accounts[accountName];
}

export function setAccount(name: string, account: AccountConfig): void {
  const config = loadConfig();
  config.accounts[name] = account;
  saveConfig(config);
}

export function setDefaultAccount(name: string): void {
  const config = loadConfig();
  config.defaultAccount = name;
  saveConfig(config);
}
