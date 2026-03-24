# xc — X API v2 CLI

A TypeScript CLI for interacting with X (Twitter) via the official API v2 with OAuth 2.0. Pay-per-use with built-in cost tracking.

## Documentation

- **X API v2 docs**: https://docs.x.com/x-api/introduction

## Project Structure

- `src/` — TypeScript source
  - `cli.ts` — main CLI entry point (commander-based)
  - `commands/` — one file per command group
  - `x-client.ts` — X API HTTP client
  - `auth.ts` — OAuth 2.0 PKCE flow
  - `config.ts` — config/token storage (`~/.xc/`)
  - `cost.ts` — cost tracking and budget enforcement
- `skill/SKILL.md` — agent skill definition (command reference)

## Key Conventions

- Commands go in `src/commands/<name>.ts` and get wired up in `src/cli.ts`
- All API calls go through `XClient` which handles auth, rate limits, and cost logging
- Config stored in `~/.xc/` (or `$XC_CONFIG_DIR`)
- Always confirm with the user before write operations (post, like, follow, DM)
