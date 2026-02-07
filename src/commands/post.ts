/**
 * Post command: create a single post or a thread of posts.
 *
 * Usage:
 *   xc post "hello"
 *   xc post "first" --thread "second" --thread "third"
 *   xc post "reply text" --reply <id>
 *   xc post "with image" --media photo.jpg
 */

import { Command } from "commander";
import { getClient } from "../lib/api.js";
import { uploadMedia } from "./media.js";

/** Result type for the posts.create SDK method. */
interface PostResult {
  data?: { id?: string; text?: string };
}

export function registerPostCommand(program: Command): void {
  program
    .command("post <text>")
    .description("Create a post (use --thread to post a thread)")
    .option("--reply <id>", "Reply to a post by ID")
    .option("--quote <id>", "Quote a post by ID")
    .option("--thread <texts...>", "Additional posts to chain as a thread")
    .option("--media <file>", "Attach media file (image, GIF, or video)")
    .option("--json", "Output raw JSON")
    .option("--account <name>", "Account to use")
    .action(async (text: string, opts) => {
      try {
        const client = await getClient(opts.account);
        const threadTexts: string[] = opts.thread ?? [];

        // All texts in order: first post + thread continuations
        const allTexts = [text, ...threadTexts];

        // Upload media if provided (attaches to the first post only)
        let mediaId: string | undefined;
        if (opts.media) {
          console.error("Uploading media...");
          mediaId = await uploadMedia(opts.media, opts.account);
        }

        // Post each tweet in sequence, chaining replies
        const posted: Array<{ id: string; text: string }> = [];
        let replyToId: string | undefined = opts.reply;

        for (let i = 0; i < allTexts.length; i++) {
          const body: Record<string, unknown> = { text: allTexts[i] };

          // First post may reply to an external ID; subsequent ones chain to the previous
          if (replyToId) {
            body.reply = { inReplyToTweetId: replyToId };
          }

          // Only the first post supports quoting and media
          if (i === 0 && opts.quote) {
            body.quoteTweetId = opts.quote;
          }
          if (i === 0 && mediaId) {
            body.media = { mediaIds: [mediaId] };
          }

          const result = (await client.posts.create(
            body as Parameters<typeof client.posts.create>[0],
          )) as PostResult;

          const data = result.data;
          const postId = data?.id;

          if (!postId) {
            console.error(`Error: failed to create post ${i + 1} (no ID returned)`);
            process.exit(1);
          }

          posted.push({ id: postId, text: data?.text ?? allTexts[i] });

          // Chain the next post as a reply to this one
          replyToId = postId;
        }

        // Output results
        if (opts.json) {
          console.log(JSON.stringify(posted, null, 2));
          return;
        }

        if (posted.length === 1) {
          // Single post
          console.log(`Posted (id: ${posted[0].id})`);
          console.log(`  ${posted[0].text}`);
        } else {
          // Thread
          console.log(`Thread posted (${posted.length} posts):`);
          for (let i = 0; i < posted.length; i++) {
            console.log(`  ${i + 1}. id:${posted[i].id}`);
            console.log(`     ${posted[i].text}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
