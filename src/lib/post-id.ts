/**
 * Extract a post ID from a raw ID or an x.com/twitter.com status URL.
 */
export function parsePostId(input: string): string {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(
    /(?:twitter\.com|x\.com)\/(?:i\/web\/)?[^/\s]+\/status\/(\d+)/,
  );
  return urlMatch ? urlMatch[1] : trimmed;
}
