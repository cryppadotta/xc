#!/usr/bin/env node

import { Command } from "commander";
import { registerAuthCommand } from "./commands/auth.js";
import { registerBlockCommand, registerUnblockCommand, registerBlockedCommand } from "./commands/block.js";
import {
  registerBookmarksCommand,
  registerBookmarkCommand,
  registerUnbookmarkCommand,
} from "./commands/bookmarks.js";
import { registerBudgetCommand } from "./commands/budget.js";
import { registerCostCommand } from "./commands/cost.js";
import { registerDmCommand } from "./commands/dm.js";
import {
  registerQuotesCommand,
  registerLikesCommand,
  registerRepostsCommand,
  registerLikedCommand,
} from "./commands/engagement.js";
import {
  registerFollowersCommand,
  registerFollowingCommand,
  registerFollowCommand,
  registerUnfollowCommand,
} from "./commands/followers.js";
import { registerHideCommand, registerUnhideCommand } from "./commands/hide.js";
import { registerLikeCommand, registerUnlikeCommand } from "./commands/like.js";
import { registerListsCommand, registerListCommand } from "./commands/lists.js";
import { registerMediaCommand } from "./commands/media.js";
import { registerMentionsCommand } from "./commands/mentions.js";
import { registerMuteCommand, registerUnmuteCommand, registerMutedCommand } from "./commands/mute.js";
import { registerDeleteCommand } from "./commands/delete.js";
import { registerGetCommand } from "./commands/get.js";
import { registerPostCommand } from "./commands/post.js";
import { registerRepostCommand, registerUnrepostCommand } from "./commands/repost.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerStreamCommand } from "./commands/stream.js";
import { registerTimelineCommand } from "./commands/timeline.js";
import { registerTrendsCommand } from "./commands/trends.js";
import { registerUsageCommand } from "./commands/usage.js";
import { registerUserCommand } from "./commands/user.js";
import { registerUserSearchCommand } from "./commands/usersearch.js";
import { registerWhoamiCommand } from "./commands/whoami.js";
import { formatCostFooter } from "./lib/cost.js";

const program = new Command();

program
  .name("xc")
  .description("CLI client for the X API v2")
  .version("0.1.0")
  .option("--quiet", "Suppress cost footer");

registerAuthCommand(program);
registerWhoamiCommand(program);
registerSearchCommand(program);
registerStreamCommand(program);
registerDeleteCommand(program);
registerGetCommand(program);
registerPostCommand(program);
registerUserCommand(program);
registerTimelineCommand(program);
registerMentionsCommand(program);
registerLikeCommand(program);
registerUnlikeCommand(program);
registerRepostCommand(program);
registerUnrepostCommand(program);
registerQuotesCommand(program);
registerLikesCommand(program);
registerRepostsCommand(program);
registerLikedCommand(program);
registerHideCommand(program);
registerUnhideCommand(program);
registerBlockCommand(program);
registerUnblockCommand(program);
registerBlockedCommand(program);
registerMuteCommand(program);
registerUnmuteCommand(program);
registerMutedCommand(program);
registerUserSearchCommand(program);
registerUsageCommand(program);
registerCostCommand(program);
registerBudgetCommand(program);
registerDmCommand(program);
registerMediaCommand(program);
registerBookmarksCommand(program);
registerBookmarkCommand(program);
registerUnbookmarkCommand(program);
registerListsCommand(program);
registerListCommand(program);
registerTrendsCommand(program);
registerFollowersCommand(program);
registerFollowingCommand(program);
registerFollowCommand(program);
registerUnfollowCommand(program);

// Show cost footer after every command (unless --quiet)
program.hook("postAction", () => {
  const opts = program.opts();
  if (opts.quiet) return;

  const footer = formatCostFooter();
  if (footer) {
    console.error(`\n${footer}`);
  }
});

program.parse();
