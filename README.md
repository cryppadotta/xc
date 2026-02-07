# xc — X API CLI

CLI client for the [X API v2](https://docs.x.com/x-api/introduction). Pay-per-use, no cookie scraping. Built on the official [@xdevplatform/xdk](https://github.com/xdevplatform/xdk) SDK with OAuth 2.0 PKCE.

## Install

```bash
git clone https://github.com/jalehman/xc.git
cd xc
pnpm install
pnpm build

# Run directly without building:
pnpm dev -- <command>
```

## Auth

xc uses **OAuth 2.0 with PKCE** — you need a Client ID from the X Developer Portal. No client secret required.

### Getting a Client ID

1. Go to [developer.x.com](https://developer.x.com) (existing apps) or [console.x.com](https://console.x.com) (new projects)
2. Create or select an app
3. Under **OAuth 2.0 settings**, copy your **Client ID**
4. Set the **Callback URL** to `http://127.0.0.1:3391/callback`
5. Enable the required scopes: `tweet.read`, `tweet.write`, `users.read`, `offline.access`

### Login

```bash
# Interactive OAuth login (opens browser)
xc auth login --client-id <YOUR_CLIENT_ID>

# App-only Bearer token (read-only, no user context)
xc auth token <BEARER_TOKEN>

# Check auth status
xc auth status

# Logout
xc auth logout
```

### Multiple Accounts

```bash
# Login with a named account
xc auth login --account work --client-id <CLIENT_ID>

# Switch default account
xc auth switch work

# Use a specific account for one command
xc search "query" --account work
```

Credentials are stored in `~/.config/xc/config.json` (or `$XC_CONFIG_DIR/config.json`).

## Commands

### Identity

```bash
xc whoami                        # Show authenticated user
xc whoami --json                 # JSON output
```

### Search

```bash
xc search "typescript"           # Search recent posts (last 7 days)
xc search "from:elonmusk" --limit 20
xc search "AI" --archive         # Full archive search (if your plan supports it)
xc search "query" --json         # Raw JSON output
```

### Users

```bash
xc user elonmusk                 # Look up a user by @username
xc user jlehman_ --json
```

### Timeline

```bash
xc timeline                      # Your home timeline
xc timeline --limit 20
xc timeline elonmusk             # A specific user's posts
xc timeline elonmusk --json
```

### Posting

```bash
xc post "Hello world"            # Create a post
xc post "Reply" --reply 123456   # Reply to a post
xc post "Check this" --quote 123 # Quote a post
xc post "First" --thread "Second" "Third"  # Post a thread
xc post "Photo" --media photo.jpg          # Post with media attachment
xc post "text" --json            # Show raw response
```

### Likes

```bash
xc like 1234567890               # Like a post by ID
xc unlike 1234567890             # Unlike a post
```

### Bookmarks

```bash
xc bookmarks                     # List your bookmarks
xc bookmark 1234567890           # Bookmark a post
xc unbookmark 1234567890         # Remove bookmark
```

### Lists

```bash
xc lists                         # List your owned lists
xc list 1234567890               # View posts in a list
```

### Followers

```bash
xc followers elonmusk            # List followers of a user
xc followers elonmusk --limit 50
xc following elonmusk            # List who a user follows
xc follow elonmusk               # Follow a user
xc unfollow elonmusk             # Unfollow a user
```

### Direct Messages

```bash
xc dm list                       # List recent DM conversations
xc dm history username           # View DM history with a user
xc dm send username "Hello"      # Send a DM
```

### Media

```bash
xc media upload photo.jpg        # Upload media, returns media_id
# Then use with post:
xc post "Check this out" --media photo.jpg
```

### Streaming

```bash
xc stream rules                  # List current stream rules
xc stream add "AI OR LLM"       # Add a filtered stream rule
xc stream remove <rule-id>      # Remove a rule by ID
xc stream clear                  # Remove all rules
xc stream connect                # Connect to stream (outputs posts in real-time)
xc stream connect --json         # Raw JSON stream output
```

## Cost Tracking

Every API call is logged to `~/.config/xc/usage.jsonl` with timestamp, endpoint, method, and estimated cost. A cost footer is appended to every command's output.

```bash
xc cost                          # Cost summary (1h, 24h, 7d, 30d)
xc cost --daily                  # Day-by-day breakdown
xc cost --json                   # Machine-readable summary
xc cost log                      # Raw request log (last 20)
xc cost log --limit 50           # More entries
xc cost log --json               # Raw JSON log
```

Suppress the per-command cost footer with `--quiet`:

```bash
xc search "query" --quiet
```

### API Usage Stats

```bash
xc usage                         # X API usage stats (tweet caps, etc.)
xc usage --json
```

## Budget Enforcement

Set daily spending limits to avoid surprise costs. Budget config lives in `~/.config/xc/budget.json`.

### Setting a Budget

```bash
xc budget set --daily 2.00                    # Warn when over $2/day
xc budget set --daily 5.00 --action block     # Block requests over $5/day
xc budget set --daily 1.00 --action confirm   # Ask for confirmation when over
```

**Actions:**
- `warn` (default) — print a warning but allow the request
- `block` — reject the request with an error
- `confirm` — prompt interactively before proceeding

### Viewing Budget Status

```bash
xc budget show
# Budget:
#
#   Daily limit: $2.00
#   Today spent: $0.45 (22%)
#   Remaining:   $1.55
#   Action:      warn
#   Locked:      no
```

### Password Protection

Lock your budget so it can't be changed without a password:

```bash
xc budget lock --password mysecret

# Now set/reset require --password
xc budget set --daily 10.00 --password mysecret
xc budget reset --password mysecret

# Remove the lock
xc budget unlock --password mysecret
```

`show` and `cost` never require a password — only `set` and `reset` do.

### Removing Budget

```bash
xc budget reset                  # Remove budget config
xc budget reset --password pass  # If locked
```

## Config

All configuration is stored in `~/.config/xc/` (or `$XC_CONFIG_DIR`):

| File | Contents |
|------|----------|
| `config.json` | Auth credentials (OAuth tokens, accounts) |
| `budget.json` | Budget limits and password lock |
| `usage.jsonl` | API request cost log (append-only) |

### Auth Config Format

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

## Development

```bash
pnpm dev -- <command>    # Run without building
pnpm build               # Compile TypeScript
pnpm lint                # Type check
pnpm test                # Run tests (vitest)
```

## Global Flags

| Flag | Description |
|------|-------------|
| `--quiet` | Suppress cost footer |
| `--json` | Raw JSON output (most commands) |
| `--account <name>` | Use a specific named account |
| `-V, --version` | Show version |
| `-h, --help` | Show help |

## License

MIT
