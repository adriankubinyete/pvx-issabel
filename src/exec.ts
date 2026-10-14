// What the install code runs on: the output of the job (`Say`). The shell that echoes into the job log is `ctx.shell.echoing`.
import type { CommandCtx, ModuleFs } from "@pvx/sdk";

export type ExecFn = CommandCtx["exec"];
export type FsRead = Pick<ModuleFs, "read" | "exists">;

/** Output of the install: the lines of `ctx.out` (module log at the matching level) and of `ctx.jobLog` (the job log; raw tool output). */
export interface Say {
  info(text: string): void;
  success(text: string): void;
  warning(text: string): void;
  error(text: string): void;
  /** One line of tool output, for the job log only. */
  raw(line: string): void;
}

export const sayOf = (ctx: Pick<CommandCtx, "out" | "jobLog">): Say => ({
  info: ctx.out.info,
  success: ctx.out.success,
  warning: ctx.out.warning,
  error: ctx.out.error,
  raw: ctx.jobLog,
});
