---
name: xc
description: X/Twitter CLI using the official API v2 with OAuth 2.0. Read, search, post, manage engagement, blocks, mutes, DMs, bookmarks, lists, followers, trends, and track API costs.
homepage: https://github.com/cryppadotta/xc
metadata: {"clawdbot":{"emoji":"𝕏","requires":{"bins":["xc"]}}}
---

# xc — X API v2 CLI

Use `xc` to interact with X (Twitter) via the official API. Pay-per-use with built-in cost tracking — no cookie scraping.

## Installation

```bash
npm install -g @dotta/xc
```

Requires Node.js >= 18.

## Setup / Authentication

xc requires OAuth 2.0 credentials from the X Developer Portal.

### First-time setup

1. Go to [developer.x.com](https://developer.x.com) or [console.x.com](https://console.x.com)
2. Create or select an app
3. Under **OAuth 2.0 settings**, copy your **Client ID** (and optionally **Client Secret**)
4. Set the **Callback URL** to `http://127.0.0.1:3391/callback`

```bash
# Interactive OAuth login (opens browser)
xc auth login --client-id <YOUR_CLIENT_ID>

# With client secret (enables automatic token refresh)
xc auth login --client-id <YOUR_CLIENT_ID> --client-secret <YOUR_SECRET>

# Check auth status
xc auth status

# App-only Bearer token (read-only, for streaming/usage)
xc auth token <BEARER_TOKEN>
```

### Multiple accounts

```bash
xc auth login --account work --client-id <CLIENT_ID>
xc auth switch work
xc search "query" --account work
```

Config stored in `~/.xc/` (or `$XC_CONFIG_DIR`).

**After upgrading**: re-authenticate with `xc auth login` to grant new scopes (block, mute, tweet.moderate).

## Quick Reference

```bash
# Identity
xc whoami                          # Who am I?
xc auth status                     # Auth status for all accounts

# Reading
xc get <post-id-or-url>              # Get a post by ID or URL (articles show full body)
xc get https://x.com/user/status/123 # Get a post by URL
xc search "query" -n 10            # Search recent posts (7-day window)
xc search "from:username" -n 5     # Search by author
xc user <username>                 # Look up user profile
xc usersearch "query"              # Search for users by keyword
xc timeline -n 10                  # Home timeline
xc timeline <username> -n 10       # User's posts
xc mentions                       # Your mentions timeline
xc mentions <username>             # Another user's mentions

# Posting
xc post "Hello world"              # Create a post
xc post "Reply" --reply <post-id>  # Reply to a post
xc post "Look" --quote <post-id>   # Quote a post
xc post "1/3" --thread "2/3" "3/3" # Post a thread
xc post "Photo" --media image.jpg  # Post with media (paid tier)
xc delete <post-id>                # Delete a post

# Engagement
xc like <post-id>                  # Like a post
xc unlike <post-id>                # Unlike a post
xc repost <post-id>                # Repost a post
xc unrepost <post-id>              # Undo a repost
xc bookmark <post-id>              # Bookmark a post
xc unbookmark <post-id>            # Remove bookmark
xc bookmarks                      # List bookmarks

# Engagement lookups
xc quotes <post-id>                # List quote tweets of a post
xc likes <post-id>                 # List users who liked a post
xc reposts <post-id>               # List users who reposted a post
xc liked                           # Posts you've liked
xc liked <username>                # Posts a user has liked

# Reply moderation
xc hide <post-id>                  # Hide a reply
xc unhide <post-id>                # Unhide a reply

# Social
xc followers <username> -n 20     # List followers
xc following <username> -n 20     # List following
xc follow <username>               # Follow a user
xc unfollow <username>             # Unfollow a user

# Blocking & Muting
xc block <username>                # Block a user
xc unblock <username>              # Unblock a user
xc blocked                         # List blocked users
xc mute <username>                 # Mute a user
xc unmute <username>               # Unmute a user
xc muted                           # List muted users

# Lists
xc lists                           # List owned lists
xc list view <list-id>             # View posts in a list
xc list create "My List"           # Create a list
xc list create "Private" --private # Create a private list
xc list update <id> --name "New"   # Update a list
xc list delete <id>                # Delete a list
xc list members <id>               # List members
xc list add <id> <username>        # Add member
xc list remove <id> <username>     # Remove member
xc list follow <id>                # Follow a list
xc list unfollow <id>              # Unfollow a list
xc list pin <id>                   # Pin a list
xc list unpin <id>                 # Unpin a list

# Trends
xc trends                          # Personalized trends
xc trends --global                 # Worldwide trends
xc trends <woeid>                  # Trends by location (WOEID)

# DMs (paid tier required)
xc dm list                         # List DM conversations
xc dm history <username>           # DM history with user
xc dm send <username> "message"    # Send a DM

# Streaming (requires Bearer Token auth)
xc stream rules                    # List stream rules
xc stream add "query"              # Add filter rule
xc stream remove <rule-id>         # Remove rule
xc stream clear                    # Remove all rules
xc stream connect                  # Connect to live stream

# Cost tracking
xc cost                            # Spending summary (1h/24h/7d/30d)
xc cost --daily                    # Day-by-day breakdown
xc cost log                        # Raw request log

# Budget
xc budget show                     # Current budget and spend
xc budget set --daily 2.00         # Set $2/day limit (warns when exceeded)
xc budget set --daily 5.00 --action block  # Block when over budget

# API usage
xc usage                           # X API usage stats (Bearer Token only)
```

## Documentation

- **X API v2 docs**: https://docs.x.com/x-api/introduction

## Important Notes

- **Cost footer**: Every command prints estimated cost. Suppress with `--quiet`.
- **JSON output**: Most commands support `--json` for machine-readable output.
- **Multi-account**: Use `--account <name>` on any command, or `xc auth switch <name>`.
- **Rate limits**: The X API has rate limits per endpoint. If you hit 429 errors, wait and retry.
- **OAuth scopes**: xc requests all scopes at login including `block.read/write`, `mute.read/write`, `tweet.moderate.write`. If you get 403 errors, re-authenticate to pick up new scopes.
- **Paid tier features**: DMs and media upload require a paid X API plan (pay-per-use or Basic+). Free tier returns 403.
- **Bearer Token features**: `stream` and `usage` commands require app-only Bearer Token auth (`xc auth token <TOKEN>`), not OAuth 2.0.
- **Search minimum**: X API returns a minimum of 10 results regardless of `-n` value.

## Posting Guidelines

**Always confirm with the user before posting.** Never post, like, repost, follow, block, mute, or send DMs without explicit approval. Read operations (search, timeline, user lookup, mentions, trends) are safe to run freely.

When composing posts:
- X limit is 280 characters (or 25,000 for Premium subscribers)
- Use `--thread` for longer content
- Delete test posts after verification: `xc delete <id>`

## Common Patterns

```bash
# Search and summarize recent discussion about a topic
xc search "topic" -n 10 --json | jq '.[] | {text: .text, author: .author}'

# Post a thread
xc post "1/ Here's a thread about..." --thread "2/ Second point" "3/ Final thought"

# Check spending before a batch operation
xc budget show
xc cost --daily

# See who engaged with a post
xc likes <post-id>
xc reposts <post-id>
xc quotes <post-id>

# Manage your block/mute lists
xc blocked --json
xc muted --json
```
