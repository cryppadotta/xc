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

Get a Client ID at https://console.x.com → Apps → Create App.

Set the callback URL to `http://127.0.0.1:3391/callback`.

## Commands

```bash
xc whoami              # Show authenticated user
xc auth status         # Auth status for all accounts
xc auth switch <name>  # Switch default account
xc auth logout         # Remove account
```

## Development

```bash
pnpm dev -- <command>  # Run without building
pnpm build             # Compile TypeScript
pnpm lint              # Type check
pnpm test              # Run tests
```
