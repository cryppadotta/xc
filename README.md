# xc — X API CLI

CLI client for the [X API v2](https://docs.x.com/x-api/introduction). Pay-per-use, no cookie scraping. Built on the official [@xdevplatform/xdk](https://github.com/xdevplatform/xdk) SDK with OAuth 2.0 PKCE, plus a local SQLite bookmark cache for offline search after sync.

## Install

```bash
npm install -g @dotta/xc
```

Requires Node.js >= 18.

## Agent Skill

xc includes an [agent skill](https://github.com/cryppadotta/xc/blob/main/skills/xc-cli/SKILL.md) so your agent can use `xc` on your behalf.

```bash
npx skills add https://github.com/cryppadotta/xc --skill xc-cli
```

## Quick Start

Get a Bearer Token from [console.x.com](https://console.x.com) and start reading immediately:

```bash
xc auth token <BEARER_TOKEN>
xc get https://x.com/dotta/status/1612500057768755201
```

Bearer tokens are read-only. For posting, liking, following, and other write operations, see [Full OAuth Setup](#full-oauth-setup) below.

## Commands

### Reading

```bash
xc get <post-id>                 # Get a post by ID
xc get https://x.com/dotta/status/1612500057768755201  # Or by URL
xc search "typescript"           # Search recent posts (last 7 days)
xc search "from:dotta" -n 20    # Search by author
xc search "AI" --archive         # Full archive search (if your plan supports it)
xc user dotta                    # Look up a user by @username
xc usersearch "keyword"          # Search for users by keyword
xc timeline                      # Your home timeline
xc timeline dotta                # A specific user's posts
xc mentions                      # Your mentions
xc mentions dotta                # Another user's mentions
xc whoami                        # Show authenticated user
```

### Posting

```bash
xc post "Hello world"            # Create a post
xc post "Reply" --reply 123456   # Reply to a post
xc post "Check this" --quote 123 # Quote a post
xc post "First" --thread "Second" "Third"  # Post a thread
xc post "Photo" --media photo.jpg          # Post with media attachment
xc post "text" --json            # Show raw response
xc delete 1234567890             # Delete a post
```

### Likes & Reposts

```bash
xc like 1234567890               # Like a post by ID
xc unlike 1234567890             # Unlike a post
xc repost 1234567890             # Repost a post
xc unrepost 1234567890           # Undo a repost
```

### Engagement Lookups

```bash
xc quotes 1234567890             # List quote tweets of a post
xc likes 1234567890              # List users who liked a post
xc reposts 1234567890            # List users who reposted a post
xc liked                         # Posts you've liked
xc liked username                # Posts liked by a user
```

### Reply Moderation

```bash
xc hide 1234567890               # Hide a reply on your post
xc unhide 1234567890             # Unhide a reply
```

### Bookmarks

```bash
xc bookmarks remote              # List your bookmarks from X
xc bookmarks local sync          # Bootstrap full coverage, then sync only new bookmarks
xc bookmarks local sync --full   # Explicitly audit every API-accessible bookmark
xc bookmarks local sync --max-pages 20 --no-wait # Bounded job; resume automatically next run
xc bookmarks local list          # Browse cached bookmarks
xc bookmarks local search "sqlite fts"
xc bookmarks local show 1234567890
xc bookmarks local status
xc bookmarks local sql 'select count(*) from bookmark_posts'
xc bookmark 1234567890           # Bookmark a post
xc unbookmark 1234567890         # Remove bookmark
```

`xc bookmarks local ...` reads from a per-account SQLite cache under `~/.xc/bookmarks/` (or `$XC_CONFIG_DIR/bookmarks/`).
Sync uses a cheap bookmark-enumeration pass plus a richer full-text hydration pass, so later syncs avoid re-fetching article bodies, long-post text, and referenced-post text that are already cached.
Each `xc bookmarks local sync` run also prints `Request cost this sync: $...` so you can see the cost of that specific sync, not just the rolling footer.

The initial sync follows every continuation token, without stopping on tweet age.
Only a scan that reaches the API's end establishes the full-coverage baseline;
legacy cache/head metadata does not establish it. Later runs fetch new bookmarks
until at least two entries from the completed head reconnect with that baseline
(one if the baseline had only one bookmark). `--full` forces a fresh audit, useful
periodically when bookmarks have been removed or reordered. The local database
is an archive: previously cached, removed bookmarks are retained.

Each page and its continuation are committed together. A page cap, interruption,
or rate limit leaves a durable cursor and hydration queue; rerunning resumes
without enumerating earlier pages or hydrating already-full posts again. New head
markers are committed only after the scan finishes. `--restart` deliberately
restarts enumeration but retains hydrated content. Only one sync per account
can run at a time. JSON/status output reports `coverageComplete`,
`fullScanCompletedAt`, and pending work; a capped/throttled run is not complete.

Enumeration requests minimal tweet fields, with 10 bookmarks per page by default,
so idle heartbeats read only a small overlap. `--page-size 1..99` is configurable;
100 is rejected because observed X responses omit its continuation token despite
more bookmarks being available. A tokenless first page at larger sizes falls back
to 10 before declaring exhaustion. Small pages can require more requests for the
one-time backfill; they do not require fetching the entire archive on every run.

All SDK requests observe X's `x-rate-limit-remaining`, `x-rate-limit-reset`, and
`Retry-After` headers. Depleted endpoint/account buckets persist across CLI runs.
The client waits until reset and retries rejected 429s at most twice; unknown
billing/cap 429s, network failures, and other failures are not blindly replayed.
`--no-wait` makes sync return saved progress and `retryAt` instead of sleeping.
API keys and paid credits do not exempt requests from rate limits. Usage logs
record successful calls only. Dollar figures remain approximate per-request
estimates, not an invoice or an accurate per-tweet spending cap.

Notes:

- `--days` on sync is retained as a compatibility label; it never truncates enumeration. Date filters on local list/search still refer to tweet publication dates, not bookmark dates. X does not expose `bookmarked_at`.
- local sync can only ingest what X's official bookmark APIs return. If the API stops early or does not paginate, `xc` cannot manufacture older bookmarks that the server does not expose.

### Blocks & Mutes

```bash
xc block username                # Block a user
xc unblock username              # Unblock a user
xc blocked                       # List blocked users
xc blocked --json                # JSON output
xc mute username                 # Mute a user
xc unmute username               # Unmute a user
xc muted                         # List muted users
```

### Lists

```bash
xc lists                         # List your owned lists
xc list view 1234567890          # View posts in a list
xc list create "My List"         # Create a new list
xc list create "Secret" --private --description "My private list"
xc list update 123 --name "New Name" --description "Updated"
xc list update 123 --public      # Make public
xc list delete 1234567890        # Delete a list
xc list members 1234567890       # List members
xc list add 123 username         # Add a member
xc list remove 123 username      # Remove a member
xc list follow 1234567890        # Follow a list
xc list unfollow 1234567890      # Unfollow a list
xc list pin 1234567890           # Pin a list
xc list unpin 1234567890         # Unpin a list
```

### Followers

```bash
xc followers dotta            # List followers of a user
xc followers dotta --limit 50
xc following dotta            # List who a user follows
xc follow dotta               # Follow a user
xc unfollow dotta             # Unfollow a user
```

### Trends

```bash
xc trends                        # Personalized trending topics
xc trends --global               # Worldwide trends
xc trends 2459115                # Trends by location (WOEID)
xc trends --json                 # JSON output
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

## Full OAuth Setup

For write operations (posting, liking, following, DMs, etc.), you need OAuth 2.0 with PKCE.

### Getting a Client ID

1. Go to [developer.x.com](https://developer.x.com) (existing apps) or [console.x.com](https://console.x.com) (new projects)
2. Create or select an app
3. Under **OAuth 2.0 settings**, copy your **Client ID** (and optionally your **Client Secret** for confidential clients)
4. Set the **Callback URL** to `http://127.0.0.1:3391/callback`
5. Enable the required scopes (xc requests all of these automatically):
   - `tweet.read`, `tweet.write` — read/write posts
   - `tweet.moderate.write` — hide/unhide replies
   - `users.read` — look up users
   - `follows.read`, `follows.write` — manage follows
   - `like.read`, `like.write` — manage likes
   - `list.read`, `list.write` — manage lists
   - `bookmark.read`, `bookmark.write` — manage bookmarks
   - `block.read`, `block.write` — manage blocks
   - `mute.read`, `mute.write` — manage mutes
   - `dm.read`, `dm.write` — read/send DMs
   - `media.write` — upload media
   - `offline.access` — refresh tokens

### Login

```bash
# Interactive OAuth login (opens browser)
xc auth login --client-id <YOUR_CLIENT_ID>

# With client secret (for confidential apps — enables token refresh)
xc auth login --client-id <YOUR_CLIENT_ID> --client-secret <YOUR_SECRET>

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

Credentials are stored in `~/.xc/config.json` (or `$XC_CONFIG_DIR/config.json`). Legacy `~/.config/xc/` configs are auto-migrated.

## Cost Tracking

Every API call is logged to `~/.xc/usage.jsonl` with timestamp, endpoint, method, and estimated cost. A cost footer is appended to every command's output.

```bash
xc cost                          # Cost summary (1h, 24h, 7d, 30d)
xc cost --daily                  # Day-by-day breakdown
xc cost --json                   # Machine-readable summary
xc cost log                      # Raw request log (last 20)
xc cost log --limit 50           # More entries
xc cost log --json               # Raw JSON log
```

Bookmark sync commands also print a per-run line like `Request cost this sync: $0.01` so you can separate one sync's spend from the rolling 1h/24h/7d/30d footer totals.

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

Set daily spending limits to avoid surprise costs. Budget config lives in `~/.xc/budget.json`.

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

All configuration is stored in `~/.xc/` (or `$XC_CONFIG_DIR`):

| File | Contents |
|------|----------|
| `config.json` | Auth credentials (OAuth tokens, accounts) |
| `budget.json` | Budget limits and password lock |
| `usage.jsonl` | API request cost log (append-only) |

Legacy `~/.config/xc/` configs are auto-migrated on first run.

## Development

```bash
git clone https://github.com/cryppadotta/xc.git
cd xc
pnpm install
pnpm build
npm link             # makes `xc` available globally

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

MIT — forked from [jalehman/xc](https://github.com/jalehman/xc).
