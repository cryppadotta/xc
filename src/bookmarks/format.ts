import {
  BookmarkStore,
  type BookmarkDetailRow,
  type BookmarkListRow,
} from "./store.js";

function formatMetrics(rawJson: string): string {
  const metrics = BookmarkStore.parseMetrics(rawJson);
  const pairs: string[] = [];

  const likeCount = metrics.likeCount ?? metrics.like_count;
  const repostCount =
    metrics.retweetCount ?? metrics.retweet_count ?? metrics.repostCount ?? metrics.repost_count;
  const replyCount = metrics.replyCount ?? metrics.reply_count;
  const quoteCount = metrics.quoteCount ?? metrics.quote_count;
  const bookmarkCount = metrics.bookmarkCount ?? metrics.bookmark_count;

  if (typeof likeCount === "number") pairs.push(`${likeCount} likes`);
  if (typeof repostCount === "number") pairs.push(`${repostCount} RTs`);
  if (typeof replyCount === "number") pairs.push(`${replyCount} replies`);
  if (typeof quoteCount === "number") pairs.push(`${quoteCount} quotes`);
  if (typeof bookmarkCount === "number") pairs.push(`${bookmarkCount} bookmarks`);

  return pairs.join(" · ");
}

function summarize(row: BookmarkListRow): string {
  return BookmarkStore.summarizeText(row);
}

export function formatBookmarkRow(row: BookmarkListRow): string {
  const lines: string[] = [];
  const author =
    row.username || row.name
      ? `@${row.username || row.authorId}${row.name ? ` (${row.name})` : ""}`
      : row.authorId;
  lines.push(author);
  lines.push(`  ${summarize(row).replace(/\n/g, "\n  ")}`);

  const metrics = formatMetrics(row.publicMetricsJson);
  if (metrics) {
    lines.push(`  ${metrics}`);
  }

  const meta: string[] = [];
  if (row.createdAt) meta.push(new Date(row.createdAt).toLocaleString());
  meta.push(`id:${row.id}`);
  if (row.hasLink) meta.push("link");
  if (row.hasMedia) meta.push("media");
  lines.push(`  ${meta.join(" · ")}`);

  return lines.join("\n");
}

export function formatBookmarkList(rows: BookmarkListRow[]): string {
  return rows.map((row) => formatBookmarkRow(row)).join("\n\n");
}

export function formatBookmarkDetail(row: BookmarkDetailRow): string {
  const lines: string[] = [formatBookmarkRow(row)];

  if (row.links.length > 0) {
    lines.push("\nLinks:");
    for (const link of row.links) {
      lines.push(`  ${link.expandedUrl || link.url || link.displayUrl}`);
    }
  }

  if (row.media.length > 0) {
    lines.push("\nMedia:");
    for (const media of row.media) {
      const parts = [media.type];
      if (media.altText) parts.push(media.altText);
      if (media.url || media.previewImageUrl) {
        parts.push(media.url || media.previewImageUrl);
      }
      lines.push(`  ${parts.filter(Boolean).join(" · ")}`);
    }
  }

  if (row.references.length > 0) {
    lines.push("\nReferences:");
    for (const reference of row.references) {
      const author = reference.username
        ? `@${reference.username}${reference.name ? ` (${reference.name})` : ""}`
        : reference.referencedPostId;
      lines.push(`  [${reference.referenceType}] ${author}`);
      if (reference.fullText) {
        lines.push(`    ${reference.fullText.replace(/\n/g, "\n    ")}`);
      }
    }
  }

  if (row.articleTitle || row.articlePlainText) {
    lines.push(`\n━━━ ${row.articleTitle || "Article"} ━━━`);
    if (row.articlePlainText) {
      lines.push(row.articlePlainText);
    }
  }

  return lines.join("\n");
}
