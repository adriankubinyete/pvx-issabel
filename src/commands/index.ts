import type { CommandDef } from "@pvx/sdk";
import type { SystemOverrides } from "../system.ts";
import { controlCommands } from "./control.ts";
import { runCommands } from "./run.ts";
import { startCommands } from "./start.ts";
import { statusCommands } from "./status.ts";

/** All the commands. `overrides` is the test seam (see system.ts): in production it is empty. */
export const createCommands = (overrides: SystemOverrides = {}): Record<string, CommandDef> => ({
  ...startCommands(overrides),
  ...runCommands(overrides),
  ...statusCommands(overrides),
  ...controlCommands,
});
