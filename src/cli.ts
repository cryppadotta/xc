#!/usr/bin/env node

import { Command } from "commander";
import { registerAuthCommand } from "./commands/auth.js";
import {
  registerBookmarksCommand,
  registerBookmarkCommand,
  registerUnbookmarkCommand,
} from "./commands/bookmarks.js";
import { registerBudgetCommand } from "./commands/budget.js";
import { registerCostCommand } from "./commands/cost.js";
import { registerDmCommand } from "./commands/dm.js";
import {
  registerFollowersCommand,
  registerFollowingCommand,
  registerFollowCommand,
  registerUnfollowCommand,
} from "./commands/followers.js";
import { registerLikeCommand, registerUnlikeCommand } from "./commands/like.js";
import { registerListsCommand, registerListCommand } from "./commands/lists.js";
import { registerMediaCommand } from "./commands/media.js";
import { registerDeleteCommand } from "./commands/delete.js";
import { registerPostCommand } from "./commands/post.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerStreamCommand } from "./commands/stream.js";
import { registerTimelineCommand } from "./commands/timeline.js";
import { registerUsageCommand } from "./commands/usage.js";
import { registerUserCommand } from "./commands/user.js";
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
registerPostCommand(program);
registerUserCommand(program);
registerTimelineCommand(program);
registerLikeCommand(program);
registerUnlikeCommand(program);
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
