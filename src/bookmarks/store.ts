import fs from "node:fs";
import Database from "better-sqlite3";
import { getBookmarkDbPath, getBookmarkDir } from "../lib/config.js";
import { parsePostId } from "../lib/post-id.js";

export type HydrationLevel = "basic" | "full";

export interface StoredUserRecord {
  id: string;
  username: string;
  name: string;
  rawJson: string;
}

export interface StoredMediaRecord {
  mediaKey: string;
  type: string;
  url: string;
  previewImageUrl: string;
  altText: string;
  rawJson: string;
}

export interface StoredLinkRecord {
  url: string;
  expandedUrl: string;
  displayUrl: string;
}

export interface StoredReferenceRecord {
  referencedPostId: string;
  referenceType: string;
}

export interface StoredPostRecord {
  id: string;
  authorId: string;
  createdAt: string;
  conversationId: string;
  lang: string;
  text: string;
  fullText: string;
  articleTitle: string;
  articlePlainText: string;
  normalizedText: string;
  publicMetricsJson: string;
  hydrationLevel: HydrationLevel;
  basicSyncedAt: string;
  fulltextSyncedAt: string;
  metricsSyncedAt: string;
  rawJson: string;
  media: StoredMediaRecord[];
  links: StoredLinkRecord[];
  references: StoredReferenceRecord[];
}

export interface BookmarkSnapshot {
  posts: StoredPostRecord[];
  users: StoredUserRecord[];
  bookmarkedIds: string[];
  syncRunId: string;
  syncedAt: string;
}

export interface BookmarkListOptions {
  author?: string;
  since?: string;
  before?: string;
  hasLink?: boolean;
  hasMedia?: boolean;
  limit?: number;
}

export interface BookmarkSearchOptions extends BookmarkListOptions {
  query: string;
}

export interface BookmarkListRow {
  id: string;
  authorId: string;
  username: string;
  name: string;
  createdAt: string;
  text: string;
  fullText: string;
  articleTitle: string;
  articlePlainText: string;
  publicMetricsJson: string;
  hasLink: boolean;
  hasMedia: boolean;
}

export interface BookmarkDetailRow extends BookmarkListRow {
  links: StoredLinkRecord[];
  media: StoredMediaRecord[];
  references: Array<{
    referencedPostId: string;
    referenceType: string;
    fullText: string;
    username: string;
    name: string;
  }>;
}

export interface BookmarkStatus {
  dbPath: string;
  bookmarkCount: number;
  postCount: number;
  userCount: number;
  mediaCount: number;
  fulltextCount: number;
  lastSyncAt: string;
  lastSyncDays: number;
  oldestFulltextCreatedAt: string;
  headWindow: string[];
  hasCompletedSync: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function pickNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value && value.trim() !== "") return value;
  }
  return "";
}

function normalizeFtsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `${term.replace(/"/g, '""')}*`)
    .join(" ");
}

function isEmptyObjectJson(raw: string): boolean {
  return raw.trim() === "" || raw.trim() === "{}";
}

export class BookmarkStore {
  private readonly db: Database.Database;
  readonly dbPath: string;

  private constructor(dbPath: string, db: Database.Database) {
    this.dbPath = dbPath;
    this.db = db;
  }

  static exists(accountName?: string): boolean {
    return fs.existsSync(getBookmarkDbPath(accountName));
  }

  static open(accountName?: string): BookmarkStore {
    fs.mkdirSync(getBookmarkDir(), { recursive: true });
    const dbPath = getBookmarkDbPath(accountName);
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");

    const store = new BookmarkStore(dbPath, db);
    store.migrate();
    return store;
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists posts (
        id text primary key,
        author_id text not null default '',
        created_at text not null default '',
        conversation_id text not null default '',
        lang text not null default '',
        text text not null default '',
        full_text text not null default '',
        article_title text not null default '',
        article_plain_text text not null default '',
        normalized_text text not null default '',
        public_metrics_json text not null default '{}',
        hydration_level text not null default 'basic',
        basic_synced_at text not null default '',
        fulltext_synced_at text not null default '',
        metrics_synced_at text not null default '',
        raw_json text not null default '{}'
      );

      create table if not exists users (
        id text primary key,
        username text not null default '',
        name text not null default '',
        raw_json text not null default '{}'
      );

      create table if not exists bookmark_posts (
        post_id text primary key references posts(id) on delete cascade,
        first_seen_at text not null,
        last_seen_at text not null,
        source_sync_run_id text not null default ''
      );

      create table if not exists media (
        media_key text primary key,
        post_id text not null references posts(id) on delete cascade,
        type text not null default '',
        url text not null default '',
        preview_image_url text not null default '',
        alt_text text not null default '',
        raw_json text not null default '{}'
      );

      create table if not exists post_links (
        post_id text not null references posts(id) on delete cascade,
        url text not null default '',
        expanded_url text not null default '',
        display_url text not null default '',
        unique(post_id, url, expanded_url, display_url)
      );

      create table if not exists referenced_posts (
        post_id text not null references posts(id) on delete cascade,
        referenced_post_id text not null references posts(id) on delete cascade,
        reference_type text not null default '',
        primary key (post_id, referenced_post_id, reference_type)
      );

      create table if not exists sync_state (
        scope text primary key,
        value text not null default '',
        updated_at text not null
      );

      create virtual table if not exists bookmark_fts using fts5(
        post_id unindexed,
        author_username,
        author_name,
        content
      );

      create index if not exists idx_posts_created_at on posts(created_at);
      create index if not exists idx_posts_author_id on posts(author_id);
      create index if not exists idx_media_post_id on media(post_id);
      create index if not exists idx_post_links_post_id on post_links(post_id);
      create index if not exists idx_referenced_posts_post_id on referenced_posts(post_id);
      create index if not exists idx_referenced_posts_ref_id on referenced_posts(referenced_post_id);
    `);
  }

  getState(scope: string): string {
    const row = this.db
      .prepare("select value from sync_state where scope = ?")
      .get(scope) as { value: string } | undefined;
    return row?.value ?? "";
  }

  setState(scope: string, value: string): void {
    const updatedAt = nowIso();
    this.db
      .prepare(`
        insert into sync_state(scope, value, updated_at)
        values(?, ?, ?)
        on conflict(scope) do update set
          value = excluded.value,
          updated_at = excluded.updated_at
      `)
      .run(scope, value, updatedAt);
  }

  hasCompletedSync(): boolean {
    return this.getState("local:last_sync_at") !== "";
  }

  getLastSyncAt(): string {
    return this.getState("local:last_sync_at");
  }

  getLastSyncDays(): number {
    const raw = this.getState("local:last_sync_days");
    return raw ? parseInt(raw, 10) : 0;
  }

  getOldestFulltextCreatedAt(): string {
    return this.getState("local:oldest_fulltext_created_at");
  }

  getHeadWindow(): string[] {
    const raw = this.getState("local:head_window");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as string[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  setHeadWindow(ids: string[]): void {
    this.setState("local:head_window", JSON.stringify(ids.slice(0, 20)));
  }

  updateSyncMetadata(days: number, oldestFulltextCreatedAt: string): void {
    this.setState("local:last_sync_at", nowIso());
    this.setState("local:last_sync_days", String(days));
    if (oldestFulltextCreatedAt) {
      const current = this.getOldestFulltextCreatedAt();
      if (!current || oldestFulltextCreatedAt < current) {
        this.setState("local:oldest_fulltext_created_at", oldestFulltextCreatedAt);
      }
    }
  }

  getHydrationLevels(ids: string[]): Map<string, HydrationLevel> {
    const uniq = unique(ids.filter(Boolean));
    const out = new Map<string, HydrationLevel>();
    if (uniq.length === 0) return out;
    const rows = this.db
      .prepare(`
        select id, hydration_level
        from posts
        where id in (${uniq.map(() => "?").join(", ")})
      `)
      .all(...uniq) as Array<{ id: string; hydration_level: HydrationLevel }>;
    for (const row of rows) {
      out.set(row.id, row.hydration_level);
    }
    return out;
  }

  getIdsNeedingHydration(ids: string[]): string[] {
    const levels = this.getHydrationLevels(ids);
    return unique(
      ids.filter((id) => {
        const level = levels.get(id);
        return level !== "full";
      }),
    );
  }

  markBookmarked(postId: string, syncRunId: string): void {
    const syncedAt = nowIso();
    this.db
      .prepare(`
        insert into bookmark_posts(post_id, first_seen_at, last_seen_at, source_sync_run_id)
        values(?, ?, ?, ?)
        on conflict(post_id) do update set
          last_seen_at = excluded.last_seen_at,
          source_sync_run_id = excluded.source_sync_run_id
      `)
      .run(postId, syncedAt, syncedAt, syncRunId);
  }

  upsertSnapshot(snapshot: BookmarkSnapshot): void {
    const tx = this.db.transaction((input: BookmarkSnapshot) => {
      const upsertUser = this.db.prepare(`
        insert into users(id, username, name, raw_json)
        values(?, ?, ?, ?)
        on conflict(id) do update set
          username = excluded.username,
          name = excluded.name,
          raw_json = excluded.raw_json
      `);

      const upsertPost = this.db.prepare(`
        insert into posts(
          id, author_id, created_at, conversation_id, lang, text, full_text,
          article_title, article_plain_text, normalized_text, public_metrics_json,
          hydration_level, basic_synced_at, fulltext_synced_at, metrics_synced_at, raw_json
        ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          author_id = case when excluded.author_id <> '' then excluded.author_id else posts.author_id end,
          created_at = case when excluded.created_at <> '' then excluded.created_at else posts.created_at end,
          conversation_id = case when excluded.conversation_id <> '' then excluded.conversation_id else posts.conversation_id end,
          lang = case when excluded.lang <> '' then excluded.lang else posts.lang end,
          text = case when excluded.text <> '' then excluded.text else posts.text end,
          full_text = case when excluded.full_text <> '' then excluded.full_text else posts.full_text end,
          article_title = case when excluded.article_title <> '' then excluded.article_title else posts.article_title end,
          article_plain_text = case when excluded.article_plain_text <> '' then excluded.article_plain_text else posts.article_plain_text end,
          normalized_text = case when excluded.normalized_text <> '' then excluded.normalized_text else posts.normalized_text end,
          public_metrics_json = case
            when excluded.public_metrics_json <> '{}' then excluded.public_metrics_json
            else posts.public_metrics_json
          end,
          hydration_level = case
            when posts.hydration_level = 'full' or excluded.hydration_level = 'full' then 'full'
            else 'basic'
          end,
          basic_synced_at = case when excluded.basic_synced_at <> '' then excluded.basic_synced_at else posts.basic_synced_at end,
          fulltext_synced_at = case when excluded.fulltext_synced_at <> '' then excluded.fulltext_synced_at else posts.fulltext_synced_at end,
          metrics_synced_at = case when excluded.metrics_synced_at <> '' then excluded.metrics_synced_at else posts.metrics_synced_at end,
          raw_json = case
            when excluded.raw_json <> '{}' then excluded.raw_json
            else posts.raw_json
          end
      `);

      const replaceBookmark = this.db.prepare(`
        insert into bookmark_posts(post_id, first_seen_at, last_seen_at, source_sync_run_id)
        values(?, ?, ?, ?)
        on conflict(post_id) do update set
          last_seen_at = excluded.last_seen_at,
          source_sync_run_id = excluded.source_sync_run_id
      `);

      const deleteMedia = this.db.prepare("delete from media where post_id = ?");
      const insertMedia = this.db.prepare(`
        insert or replace into media(
          media_key, post_id, type, url, preview_image_url, alt_text, raw_json
        ) values(?, ?, ?, ?, ?, ?, ?)
      `);

      const deleteLinks = this.db.prepare("delete from post_links where post_id = ?");
      const insertLink = this.db.prepare(`
        insert or ignore into post_links(post_id, url, expanded_url, display_url)
        values(?, ?, ?, ?)
      `);

      const deleteRefs = this.db.prepare("delete from referenced_posts where post_id = ?");
      const insertRef = this.db.prepare(`
        insert or replace into referenced_posts(post_id, referenced_post_id, reference_type)
        values(?, ?, ?)
      `);

      for (const user of input.users) {
        upsertUser.run(user.id, user.username, user.name, user.rawJson);
      }

      const bookmarked = new Set(input.bookmarkedIds);
      for (const post of input.posts) {
        upsertPost.run(
          post.id,
          post.authorId,
          post.createdAt,
          post.conversationId,
          post.lang,
          post.text,
          post.fullText,
          post.articleTitle,
          post.articlePlainText,
          post.normalizedText,
          post.publicMetricsJson,
          post.hydrationLevel,
          post.basicSyncedAt,
          post.fulltextSyncedAt,
          post.metricsSyncedAt,
          post.rawJson,
        );

      }

      for (const post of input.posts) {
        deleteMedia.run(post.id);
        for (const media of post.media) {
          insertMedia.run(
            media.mediaKey,
            post.id,
            media.type,
            media.url,
            media.previewImageUrl,
            media.altText,
            media.rawJson,
          );
        }

        deleteLinks.run(post.id);
        for (const link of post.links) {
          insertLink.run(post.id, link.url, link.expandedUrl, link.displayUrl);
        }

        deleteRefs.run(post.id);
        for (const ref of post.references) {
          insertRef.run(post.id, ref.referencedPostId, ref.referenceType);
        }

        if (bookmarked.has(post.id)) {
          replaceBookmark.run(post.id, input.syncedAt, input.syncedAt, input.syncRunId);
        }
      }
    });

    tx(snapshot);

    const touchedIds = unique([
      ...snapshot.posts.map((post) => post.id),
      ...snapshot.posts.flatMap((post) => post.references.map((ref) => ref.referencedPostId)),
    ]);
    this.reindexPostsAndDependents(touchedIds);
  }

  private reindexPostsAndDependents(ids: string[]): void {
    const queue = new Set(ids.filter(Boolean));
    const parentStmt = this.db.prepare(`
      select post_id
      from referenced_posts
      where referenced_post_id = ?
    `);

    for (const id of [...queue]) {
      const parents = parentStmt.all(id) as Array<{ post_id: string }>;
      for (const parent of parents) {
        queue.add(parent.post_id);
      }
    }

    for (const id of queue) {
      this.reindexPost(id);
    }
  }

  private reindexPost(postId: string): void {
    const row = this.db
      .prepare(`
        select
          p.id,
          p.text,
          p.full_text,
          p.article_title,
          p.article_plain_text,
          coalesce(u.username, '') as username,
          coalesce(u.name, '') as name
        from posts p
        left join users u on u.id = p.author_id
        where p.id = ?
      `)
      .get(postId) as
      | {
          id: string;
          text: string;
          full_text: string;
          article_title: string;
          article_plain_text: string;
          username: string;
          name: string;
        }
      | undefined;

    this.db.prepare("delete from bookmark_fts where post_id = ?").run(postId);
    if (!row) return;

    const links = this.db
      .prepare(`
        select coalesce(expanded_url, ''), coalesce(display_url, ''), coalesce(url, '')
        from post_links
        where post_id = ?
      `)
      .all(postId) as Array<Record<string, string>>;
    const media = this.db
      .prepare(`
        select coalesce(alt_text, ''), coalesce(url, ''), coalesce(preview_image_url, '')
        from media
        where post_id = ?
      `)
      .all(postId) as Array<Record<string, string>>;
    const refs = this.db
      .prepare(`
        select
          coalesce(p.full_text, ''),
          coalesce(p.article_plain_text, ''),
          coalesce(p.text, '')
        from referenced_posts rp
        left join posts p on p.id = rp.referenced_post_id
        where rp.post_id = ?
      `)
      .all(postId) as Array<Record<string, string>>;

    const content = [
      row.full_text,
      row.text,
      row.article_title,
      row.article_plain_text,
      ...links.flatMap((link) => Object.values(link)),
      ...media.flatMap((item) => Object.values(item)),
      ...refs.flatMap((ref) => Object.values(ref)),
    ]
      .map((value) => value.trim())
      .filter(Boolean)
      .join("\n");

    this.db
      .prepare(`
        insert into bookmark_fts(post_id, author_username, author_name, content)
        values(?, ?, ?, ?)
      `)
      .run(postId, row.username, row.name, content);
  }

  getStatus(): BookmarkStatus {
    const bookmarkCount =
      (this.db.prepare("select count(*) as count from bookmark_posts").get() as { count: number }).count ?? 0;
    const postCount =
      (this.db.prepare("select count(*) as count from posts").get() as { count: number }).count ?? 0;
    const userCount =
      (this.db.prepare("select count(*) as count from users").get() as { count: number }).count ?? 0;
    const mediaCount =
      (this.db.prepare("select count(*) as count from media").get() as { count: number }).count ?? 0;
    const fulltextCount =
      (this.db.prepare("select count(*) as count from posts where hydration_level = 'full'").get() as { count: number }).count ?? 0;

    return {
      dbPath: this.dbPath,
      bookmarkCount,
      postCount,
      userCount,
      mediaCount,
      fulltextCount,
      lastSyncAt: this.getLastSyncAt(),
      lastSyncDays: this.getLastSyncDays(),
      oldestFulltextCreatedAt: this.getOldestFulltextCreatedAt(),
      headWindow: this.getHeadWindow(),
      hasCompletedSync: this.hasCompletedSync(),
    };
  }

  listBookmarks(opts: BookmarkListOptions = {}): BookmarkListRow[] {
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 20;
    const clauses = ["1=1"];
    const args: unknown[] = [];

    if (opts.author?.trim()) {
      clauses.push("(coalesce(u.username, '') like ? or coalesce(u.name, '') like ?)");
      args.push(`%${opts.author.trim()}%`, `%${opts.author.trim()}%`);
    }
    if (opts.since) {
      clauses.push("p.created_at >= ?");
      args.push(opts.since);
    }
    if (opts.before) {
      clauses.push("p.created_at <= ?");
      args.push(opts.before);
    }
    if (opts.hasLink) {
      clauses.push("exists(select 1 from post_links pl where pl.post_id = p.id)");
    }
    if (opts.hasMedia) {
      clauses.push("exists(select 1 from media m where m.post_id = p.id)");
    }

    args.push(limit);
    return this.db
      .prepare(`
        select
          p.id,
          p.author_id as authorId,
          coalesce(u.username, '') as username,
          coalesce(u.name, '') as name,
          p.created_at as createdAt,
          p.text,
          p.full_text as fullText,
          p.article_title as articleTitle,
          p.article_plain_text as articlePlainText,
          p.public_metrics_json as publicMetricsJson,
          exists(select 1 from post_links pl where pl.post_id = p.id) as hasLink,
          exists(select 1 from media m where m.post_id = p.id) as hasMedia
        from bookmark_posts bp
        join posts p on p.id = bp.post_id
        left join users u on u.id = p.author_id
        where ${clauses.join(" and ")}
        order by p.created_at desc, bp.last_seen_at desc
        limit ?
      `)
      .all(...args) as BookmarkListRow[];
  }

  searchBookmarks(opts: BookmarkSearchOptions): BookmarkListRow[] {
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 20;
    const ftsQuery = normalizeFtsQuery(opts.query);
    if (!ftsQuery) return [];

    const clauses = ["bookmark_fts match ?"];
    const args: unknown[] = [ftsQuery];

    if (opts.author?.trim()) {
      clauses.push("(coalesce(u.username, '') like ? or coalesce(u.name, '') like ?)");
      args.push(`%${opts.author.trim()}%`, `%${opts.author.trim()}%`);
    }
    if (opts.since) {
      clauses.push("p.created_at >= ?");
      args.push(opts.since);
    }
    if (opts.before) {
      clauses.push("p.created_at <= ?");
      args.push(opts.before);
    }
    if (opts.hasLink) {
      clauses.push("exists(select 1 from post_links pl where pl.post_id = p.id)");
    }
    if (opts.hasMedia) {
      clauses.push("exists(select 1 from media m where m.post_id = p.id)");
    }

    args.push(limit);

    try {
      return this.db
        .prepare(`
          select
            p.id,
            p.author_id as authorId,
            coalesce(u.username, '') as username,
            coalesce(u.name, '') as name,
            p.created_at as createdAt,
            p.text,
            p.full_text as fullText,
            p.article_title as articleTitle,
            p.article_plain_text as articlePlainText,
            p.public_metrics_json as publicMetricsJson,
            exists(select 1 from post_links pl where pl.post_id = p.id) as hasLink,
            exists(select 1 from media m where m.post_id = p.id) as hasMedia
          from bookmark_fts
          join bookmark_posts bp on bp.post_id = bookmark_fts.post_id
          join posts p on p.id = bp.post_id
          left join users u on u.id = p.author_id
          where ${clauses.join(" and ")}
          order by bm25(bookmark_fts), p.created_at desc
          limit ?
        `)
        .all(...args) as BookmarkListRow[];
    } catch {
      return this.db
        .prepare(`
          select
            p.id,
            p.author_id as authorId,
            coalesce(u.username, '') as username,
            coalesce(u.name, '') as name,
            p.created_at as createdAt,
            p.text,
            p.full_text as fullText,
            p.article_title as articleTitle,
            p.article_plain_text as articlePlainText,
            p.public_metrics_json as publicMetricsJson,
            exists(select 1 from post_links pl where pl.post_id = p.id) as hasLink,
            exists(select 1 from media m where m.post_id = p.id) as hasMedia
          from bookmark_posts bp
          join posts p on p.id = bp.post_id
          left join users u on u.id = p.author_id
          where p.normalized_text like ?
          order by p.created_at desc
          limit ?
        `)
        .all(`%${opts.query}%`, limit) as BookmarkListRow[];
    }
  }

  getBookmark(postIdOrUrl: string): BookmarkDetailRow | null {
    const id = parsePostId(postIdOrUrl);
    const row = this.db
      .prepare(`
        select
          p.id,
          p.author_id as authorId,
          coalesce(u.username, '') as username,
          coalesce(u.name, '') as name,
          p.created_at as createdAt,
          p.text,
          p.full_text as fullText,
          p.article_title as articleTitle,
          p.article_plain_text as articlePlainText,
          p.public_metrics_json as publicMetricsJson,
          exists(select 1 from post_links pl where pl.post_id = p.id) as hasLink,
          exists(select 1 from media m where m.post_id = p.id) as hasMedia
        from bookmark_posts bp
        join posts p on p.id = bp.post_id
        left join users u on u.id = p.author_id
        where p.id = ?
      `)
      .get(id) as BookmarkListRow | undefined;
    if (!row) return null;

    const links = this.db
      .prepare(`
        select url, expanded_url as expandedUrl, display_url as displayUrl
        from post_links
        where post_id = ?
        order by expanded_url, url
      `)
      .all(id) as StoredLinkRecord[];

    const media = this.db
      .prepare(`
        select
          media_key as mediaKey,
          type,
          url,
          preview_image_url as previewImageUrl,
          alt_text as altText,
          raw_json as rawJson
        from media
        where post_id = ?
        order by media_key
      `)
      .all(id) as StoredMediaRecord[];

    const references = this.db
      .prepare(`
        select
          rp.referenced_post_id as referencedPostId,
          rp.reference_type as referenceType,
          coalesce(p.full_text, p.text, '') as fullText,
          coalesce(u.username, '') as username,
          coalesce(u.name, '') as name
        from referenced_posts rp
        left join posts p on p.id = rp.referenced_post_id
        left join users u on u.id = p.author_id
        where rp.post_id = ?
        order by rp.reference_type, rp.referenced_post_id
      `)
      .all(id) as BookmarkDetailRow["references"];

    return {
      ...row,
      links,
      media,
      references,
    };
  }

  runReadOnlyQuery(query: string): { columns: string[]; rows: string[][] } {
    const statement = this.db.prepare(query);
    if (!statement.reader) {
      throw new Error("Only read-only SQL is allowed");
    }

    const columns = statement.columns().map((column) => column.name);
    const rawRows = statement.all() as Array<Record<string, unknown>>;
    const rows = rawRows.map((row) =>
      columns.map((column) => {
        const value = row[column];
        return value == null ? "" : String(value);
      }),
    );
    return { columns, rows };
  }

  static summarizeText(row: Pick<BookmarkListRow, "text" | "fullText" | "articleTitle" | "articlePlainText">): string {
    return pickNonEmpty(
      row.fullText,
      row.text,
      [row.articleTitle, row.articlePlainText].filter(Boolean).join("\n\n"),
    );
  }

  static parseMetrics(rawJson: string): Record<string, number> {
    if (isEmptyObjectJson(rawJson)) return {};
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      const out: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "number") out[key] = value;
      }
      return out;
    } catch {
      return {};
    }
  }
}
