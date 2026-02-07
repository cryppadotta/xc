#!/usr/bin/env node

import { Command } from "commander";
import { registerAuthCommand } from "./commands/auth.js";
import { registerWhoamiCommand } from "./commands/whoami.js";

const program = new Command();

program
  .name("xc")
  .description("CLI client for the X API v2")
  .version("0.1.0");

registerAuthCommand(program);
registerWhoamiCommand(program);

program.parse();
