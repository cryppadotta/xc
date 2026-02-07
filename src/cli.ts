#!/usr/bin/env node

import { Command } from "commander";
import { registerAuthCommand } from "./commands/auth.js";
import { registerLikeCommand, registerUnlikeCommand } from "./commands/like.js";
import { registerPostCommand } from "./commands/post.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerTimelineCommand } from "./commands/timeline.js";
import { registerUsageCommand } from "./commands/usage.js";
import { registerUserCommand } from "./commands/user.js";
import { registerWhoamiCommand } from "./commands/whoami.js";

const program = new Command();

program
  .name("xc")
  .description("CLI client for the X API v2")
  .version("0.1.0");

registerAuthCommand(program);
registerWhoamiCommand(program);
registerSearchCommand(program);
registerPostCommand(program);
registerUserCommand(program);
registerTimelineCommand(program);
registerLikeCommand(program);
registerUnlikeCommand(program);
registerUsageCommand(program);

program.parse();
