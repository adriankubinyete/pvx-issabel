import type { CommandDef, Sdk } from "@pvx/sdk";
import { controlCommands } from "./control.ts";
import { runCommands } from "./run.ts";
import { startCommands } from "./start.ts";
import { statusCommands } from "./status.ts";

export const createCommands = (sdk: Sdk): Record<string, CommandDef> => ({
  ...startCommands,
  ...runCommands(sdk),
  ...statusCommands,
  ...controlCommands,
});
