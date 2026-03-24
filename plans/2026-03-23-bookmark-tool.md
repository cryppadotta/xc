# `xc` Bookmark Cache Plan

## Goal

Add a local-bookmark archive to `xc` so bookmark reads/searches happen against a local SQLite cache after sync, minimizing paid X API requests.

This should feel like a focused `discrawl`-style sub-feature:

- `xc bookmarks remote`
- `xc bookmarks local sync`
- `xc bookmarks local search <query>`
- `xc bookmarks local list ...`
- `xc bookmarks local show <post-id|url>`
- `xc bookmarks local sql <query>`
- `xc bookmarks local status`

## What To Borrow From `discrawl`

After reviewing `/Users/dotta/paperclipai/discord/discrawl`, the parts worth copying are structural, not Discord-specific:

- Store/sync/query split.
  - Storage and schema live in `internal/store/store.go`, `internal/store/write.go`, `internal/store/query.go`.
  - Sync orchestration is separate in `internal/syncer/...`.
  - CLI commands stay thin in `internal/cli/query_commands.go`, `internal/cli/messages.go`, `internal/cli/mentions.go`.
- Local-first query UX.
  - `search`, `messages`, `mentions`, `sql`, `status` all read from the local DB.
  - `messages --sync` shows a good pattern for optional blocking refresh before query.
- Explicit sync state.
  - `sync_state` is the key idea. It makes resumable sync and cheap incremental refresh possible.
- SQLite + FTS.
  - `discrawl` uses normal tables for canonical records plus FTS virtual tables for fast search.
- Read-only power-user SQL.
  - `sql` is useful once the cache exists, but should default to read-only.

That architecture maps cleanly to `xc`.

## X API Constraints That Shape The Design

Verified against the current official X docs for `GET /2/users/{id}/bookmarks` on March 23, 2026:

- bookmarks are fetched from `GET /2/users/{id}/bookmarks`
- `max_results` is `1..100`
- pagination uses `pagination_token`
- the endpoint returns current bookmarks, not a bookmark-event history
- X also documents `GET /2/tweets` for multi-post lookup, up to 100 IDs per request
- X’s docs note that retweet text can be truncated and recommend `referenced_tweets.id` expansion to get full source text
- current public metrics docs clearly expose likes / reposts / replies / quotes; I did not find a standard `bookmark_count` field in the public docs, so that metric should be treated as best-effort only if it appears in payloads

That means the local cache should behave like an append-only archive:

- if a bookmark was synced once, it can stay forever
- sync only cares about additions and hydration quality
- local writes after `xc bookmark` / `xc unbookmark` should still update state, but removal no longer needs reconciliation work

## Proposed `xc` Architecture

Use a small local SQLite subsystem under `src/bookmarks/`:

- `src/bookmarks/store.ts`
  - open DB
  - run migrations
  - expose typed upsert/query helpers
- `src/bookmarks/sync.ts`
  - incremental bookmark enumeration
  - hydration planning
  - sync-state management
- `src/bookmarks/search.ts`
  - FTS query helpers
  - exact filter helpers for list/show
- `src/commands/bookmarks.ts`
  - convert into a command group with thin subcommands

Storage location:

- per account DB under `~/.xc/bookmarks/<account>.db`
- keep it outside the repo and alongside existing `~/.xc/` state

Recommended dependency:

- `better-sqlite3`

Reason:

- simplest TypeScript CLI ergonomics
- single-process local access
- straightforward migrations and prepared statements
- bundled SQLite features are usually a better fit here than async wrappers

If install friction becomes a problem, fallback is `sqlite3`, but `better-sqlite3` is the cleaner first choice.

## Schema Proposal

Keep canonical post data separate from bookmark membership.

### Core tables

- `posts`
  - `id`
  - `author_id`
  - `conversation_id`
  - `created_at`
  - `lang`
  - `text`
  - `full_text`
  - `article_title`
  - `article_plain_text`
  - `normalized_text`
  - `public_metrics_json`
  - `hydration_level`
  - `basic_synced_at`
  - `fulltext_synced_at`
  - `metrics_synced_at`
  - `raw_json`
- `bookmark_posts`
  - `post_id primary key`
  - `account_name`
  - `first_seen_at`
  - `last_seen_at`
  - `source_sync_run_id`
- `users`
  - `id`
  - `username`
  - `name`
  - `raw_json`
- `media`
  - `media_key`
  - `post_id`
  - `type`
  - `url`
  - `preview_image_url`
  - `alt_text`
  - `raw_json`
- `post_links`
  - extracted URLs for exact filtering
- `referenced_posts`
  - `post_id`
  - `referenced_post_id`
  - `reference_type`
- `sync_state`
  - `scope`
  - `cursor`
  - `updated_at`

### Search index

- `bookmark_fts`
  - `post_id`
  - `author_username`
  - `author_name`
  - `content`

`content` should be a flattened searchable string composed from:

- post text
- `note_tweet` full text when present
- article title/body when hydrated
- URL strings / expanded URLs
- referenced-post text when expanded
- media alt text

This is the equivalent of `discrawl`’s `normalized_content`: make one good offline search surface instead of requiring live lookups.

## Sync Strategy

### 1. Two sync layers: cheap enumeration, expensive hydration

The current `xc get` path already asks for richer single-post fields:

- `article`
- `note_tweet`
- `public_metrics`

That needs to be reflected in bookmark sync so we do not pay twice for the same post.

Proposed model:

- `basic` sync:
  - enumerate bookmark pages cheaply
  - store IDs, author, created time, short text, metrics from the bookmark list payload
  - populate users/media/links/reference edges
- `fulltext` hydration:
  - for posts missing rich text, article body, or source-post text
  - use batched `GET /2/tweets?ids=...` where possible
  - request `article`, `note_tweet`, `referenced_tweets.id`, `referenced_tweets.id.author_id`, media, and metrics
  - mark per-post hydration state so the same post is not rehydrated on later syncs unless forced

This keeps the expensive work idempotent and stateful.

### 2. Incremental sync as the default

Goal: minimize paid requests.

Algorithm:

1. Fetch page 1 with `max_results=100`.
2. Upsert cheap bookmark rows from that page.
3. Queue any unseen or under-hydrated posts for later hydration.
4. Compare returned bookmark IDs against a stored “recent head window” from the last sync.
5. If any known head ID appears, stop bookmark enumeration. We have reached already-cached territory.
6. Otherwise continue paging until:
   - a known head ID appears
   - results are exhausted
   - or a user-specified safety cap is reached
7. Batch-hydrate only queued posts that need richer text/metrics.
8. Update the head window in `sync_state`.

Why a head window instead of one ID:

- storing the most recent 10-20 IDs gives much safer early-stop behavior

### 3. Default 30-day local sync window, extendable without rehydrating old work

Default behavior:

- `xc bookmarks local sync` targets posts with `created_at >= now - 30 days`

Extended behavior:

- `xc bookmarks local sync --days 60` extends coverage to 60 days
- later `--days 90` extends again
- already stored posts are not reinserted
- already hydrated posts are not rehydrated unless missing the requested hydration level

Important nuance:

- because the X bookmarks endpoint paginates by bookmark list order, not by an exposed bookmark timestamp, we still have to walk earlier pages to reach deeper history
- but we can avoid duplicate expensive hydration by using the per-post hydration state
- in practice, “days” should mean post `created_at` coverage, because X does not expose “bookmarked_at”

State to persist:

- last sync time
- last requested coverage window in days
- oldest `created_at` currently covered with fulltext hydration
- head window IDs
- per-post hydration level timestamps

### 4. Reposts / source-post text must be accounted for

This is a real requirement, not a nice-to-have.

As of March 23, 2026, X’s docs explicitly warn that retweet text can be truncated and point to `referenced_tweets.id` expansion for full source text. So bookmark sync should:

- store reference edges from the bookmark payload
- hydrate referenced source posts when the bookmark is a repost / quote and source text is missing locally
- include source-post text in the local searchable blob
- avoid rehydrating the same source post if it is already present

### 5. Immediate local mutations after writes

After successful:

- `xc bookmark <id>`
- `xc unbookmark <id>`

update the local DB in the same command path so the cache stays coherent.

For `unbookmark`, do not remove the cached post. Just mark that it is no longer in the current live bookmark set if we need that state for UI, or simply leave the archive row alone if we decide the archive is append-only.

## CLI Shape

Recommended target shape:

- `xc bookmarks remote`
- `xc bookmarks remote --limit 50`
- `xc bookmarks local sync`
- `xc bookmarks local sync --days 60`
- `xc bookmarks local sync --max-pages 3`
- `xc bookmarks local search "rust sqlite"`
- `xc bookmarks local list --author steipete --days 30 --has-link`
- `xc bookmarks local show 1901234567890123456`
- `xc bookmarks local show https://x.com/.../status/...`
- `xc bookmarks local status`
- `xc bookmarks local sql 'select count(*) from bookmark_posts'`

Behavioral rule:

- if local commands are run before any sync, print a clear message like:
  - no local bookmark cache found; run `xc bookmarks local sync`
- if a cache exists, local commands should mention the last sync timestamp in human output where useful

Good second-wave commands if the first cut lands well:

- `xc bookmarks authors <query>`
- `xc bookmarks links <query>`
- `xc bookmarks export --format jsonl`
- `xc bookmarks vacuum`

## Query Features To Include In V1

### `search`

FTS-backed keyword search over cached bookmarks with optional filters:

- `--author`
- `--since`
- `--before`
- `--has-link`
- `--has-media`
- `--limit`

### `list`

Non-FTS exact browsing over local rows:

- newest first
- filter by author
- filter by date range
- filter by media/link presence
- optionally `--last N`

This is the `discrawl messages` analogue.

### `show`

Display one cached bookmark with:

- author
- created time
- full local text
- URLs
- media summary
- referenced/quoted post summary when present

### `status`

Show:

- DB path
- cached bookmark count
- post/user/media row counts
- hydrated fulltext count
- last local sync time
- current default coverage window
- oldest fully hydrated `created_at`
- stored head window

### `sql`

Read-only SQL by default.

Same idea as `discrawl sql`: once the local cache exists, raw SQL becomes a cheap power-user interface.

## API Request Efficiency Rules

The syncer should optimize for request count first.

- always use `max_results=100`
- request only fields we intend to persist/search
- avoid per-post follow-up calls in the hot path
- prefer batched `GET /2/tweets?ids=...` hydration over one-post-at-a-time lookups
- expand related objects in the bookmark list call where possible
- never fetch linked article bodies as part of default sync
- keep expensive hydration stateful so later syncs skip already-complete rows

Suggested fields for baseline bookmark enumeration:

- tweet fields:
  - `author_id`
  - `created_at`
  - `conversation_id`
  - `entities`
  - `attachments`
  - `referenced_tweets`
  - `lang`
  - `public_metrics`
- expansions:
  - `author_id`
  - `attachments.media_keys`
  - `referenced_tweets.id`
  - `referenced_tweets.id.author_id`
- user fields:
  - `name`
  - `username`
- media fields:
  - `type`
  - `url`
  - `preview_image_url`
  - `alt_text`

Suggested fields for the fulltext hydration pass:

- tweet fields:
  - `author_id`
  - `created_at`
  - `conversation_id`
  - `entities`
  - `attachments`
  - `referenced_tweets`
  - `lang`
  - `note_tweet`
  - `article`
  - `public_metrics`
- expansions:
  - `author_id`
  - `attachments.media_keys`
  - `referenced_tweets.id`
  - `referenced_tweets.id.author_id`
- user fields:
  - `name`
  - `username`
- media fields:
  - `type`
  - `url`
  - `preview_image_url`
  - `alt_text`

## Command Compatibility Decision

Accepted direction:

- convert `xc bookmarks` into a group
- move the existing one-shot network list to `xc bookmarks remote`
- make the local cache surface live under `xc bookmarks local ...`
- keep `xc bookmark` and `xc unbookmark` as top-level write commands

## Implementation Phases

Build all phases; do not stop after a minimal slice.

### Phase 1: Storage, sync state, and command reshape

- add SQLite dependency
- create bookmark DB open/migrate helpers
- define schema and indexes
- convert `xc bookmarks` into `remote` + `local`
- add unsynced-cache messaging
- implement sync state helpers
- implement head-window bookmark enumeration
- implement 30-day default coverage and `--days N` extension rules
- add `xc bookmarks local sync`
- add `xc bookmarks local status`

### Phase 2: Hydration and reference handling

- add per-post hydration levels
- add batched fulltext/article hydration
- hydrate referenced/source posts for reposts and quotes
- persist metrics snapshots from hydration responses
- ensure re-syncs skip already-complete expensive work

### Phase 3: Local query surface

- add FTS index and rebuild logic
- add `local search`
- add `local list`
- add `local show`
- add read-only `local sql`

### Phase 4: Cache coherence and polish

- update local cache after `bookmark` / `unbookmark`
- document storage layout and workflows in `README.md`
- add output formatting for bookmark search/list/show
- add migration messaging for the old `xc bookmarks` behavior

## Tests

Need coverage in three layers:

- store tests
  - migrations
  - upsert logic
  - FTS rebuild
  - hydration-level state transitions
- sync tests
  - incremental early-stop
  - head-window behavior
  - default 30-day coverage
  - extend-to-60-day coverage without duplicate hydration
  - pagination caps
  - repost/source hydration
  - local mutation after bookmark/unbookmark
- CLI tests
  - command parsing
  - output modes
  - read-only SQL safety
  - unsynced local-cache messaging

Mock the X client at the SDK boundary, similar to the existing command tests in `src/__tests__/bookmarks.test.ts`.

## Risks / Open Questions

- The bookmark endpoint does not expose bookmark timestamps, only post timestamps.
  - local UX should avoid pretending we know “when you bookmarked this”.
  - `--days` therefore means post `created_at` coverage.
- `better-sqlite3` adds a native dependency.
  - probably worth it, but this is still a packaging decision.
- The current `src/commands/bookmarks.ts` file name conflicts with a future group command design.
  - likely worth keeping the path and refactoring internals rather than inventing a second bookmark command module.
- Official docs currently expose public metrics like likes and reposts, but I did not find a standard `bookmark_count` field.
  - plan should persist bookmark counts only if the SDK payload actually exposes them.

## Implementation Target

Build the full command surface described above, not just a first cut.
