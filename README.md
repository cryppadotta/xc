# xc — X API CLI

CLI client for the [X API v2](https://docs.x.com/x-api/introduction). Pay-per-use, no cookie scraping.

## Setup

```bash
pnpm install
pnpm build

# Or run directly:
pnpm dev -- auth login
```

## Auth

```bash
# OAuth 2.0 with PKCE (read + write)
xc auth login --client-id <YOUR_CLIENT_ID>

# Or app-only Bearer token (read only)
xc auth token <BEARER_TOKEN>

# Check status
xc auth status

# Multiple accounts
xc auth login --account pagedrop --client-id <ID>
xc auth switch pagedrop
```

## Getting a Client ID

**Option A: Use the legacy portal (developer.x.com)**
1. Go to https://developer.x.com and sign in
2. Go to **Projects & Apps** → your app
3. Click the **gear icon** (settings) for your app
4. Look for **"User authentication settings"** or **"OAuth 2.0"**
5. Your **Client ID** should be visible there
6. Set the **Callback URL** to `http://127.0.0.1:3391/callback`

**Option B: Use the new console (console.x.com)**
1. Go to https://console.x.com and sign up/sign in
2. Create a new project and app
3. Go to **Keys and Tokens** or **OAuth 2.0** settings
4. Copy your **Client ID**
5. Set the callback URL to `http://127.0.0.1:3391/callback`

**Note:** The legacy portal (developer.x.com) shows existing apps and OAuth settings. The new console (console.x.com) is for new projects. The OAuth 2.0 Client ID is configured per-app.

## OAuth 2.0 Setup Requirements

| Field | Value |
|-------|-------|
| Callback URL | `http://127.0.0.1:3391/callback` |
| Required Scopes | `tweet.read`, `tweet.write`, `users.read`, `offline.access` |

The CLI uses **PKCE** (Proof Key for Code Exchange), so you don't need a client secret — only the Client ID.

## Commands

```bash
xc whoami              # Show authenticated user
xc auth status         # Auth status for all accounts
xc auth switch <name>  # Switch default account
xc auth logout         # Remove account
```

## Testing the OAuth Flow

```bash
# From the xc project directory:
cd ~/Projects/xc

# Build and run:
pnpm build
./dist/cli.js auth login --client-id <YOUR_CLIENT_ID>

# This will:
# 1. Start a local server on port 3391
# 2. Open your browser to the X authorization page
# 3. Click "Authorize" when prompted
# 4. Receive the callback and exchange for tokens
# 5. Store credentials in ~/.config/xc/config.json
```

## Development

```bash
pnpm dev -- <command>  # Run without building
pnpm build             # Compile TypeScript
pnpm lint              # Type check
pnpm test              # Run tests
```

## Config Location

Auth credentials are stored in: `~/.config/xc/config.json` (or `$XC_CONFIG_DIR/config.json`)

Format:
```json
{
  "defaultAccount": "default",
  "accounts": {
    "default": {
      "name": "default",
      "auth": {
        "type": "oauth2",
        "clientId": "<YOUR_CLIENT_ID>",
        "accessToken": "...",
        "refreshToken": "...",
        "expiresAt": 1234567890000
      }
    }
  }
}
```
