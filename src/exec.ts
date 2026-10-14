// What the install code runs on: the output of the job (`Say`) and a shell that also writes the job log. The shell itself, with its
// `StepError`, is `ctx.shell`; here is only what the host does not give.
import type { AbortSignalLike, CommandCtx, ModuleFs, Shell, ShellOpts, StepError } from "@pvx/sdk";

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

/** A failure the module finds by itself, not a bad exit: the phase runner records it like the `StepError` that `shell.must` throws (it only looks at the shape). */
export function stepError(message: string, command: string, code: number | undefined, output: string[]): StepError {
  return Object.assign(new Error(message), { name: "StepError" as const, command, code, output });
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

const commandText = (command: string, args: string[]) => [command, ...args].join(" ");

/** The options of one call: the command echoed in the job log first, then every output line, and the job's signal on the process. */
function loggedOpts(say: Say, signal: AbortSignalLike, command: string, args: string[], opts: ShellOpts = {}): ShellOpts {
  say.raw(`$ ${opts.display ?? commandText(command, args)}`);
  const onLine: ShellOpts["onLine"] = (line, stream) => {
    if (line.trim()) say.raw(line);
    opts.onLine?.(line, stream);
  };
  // A signal on every exec puts each program in its own process group: that is what lets `jobs.stop` kill them with the job.
  // Output is only streamed by default: a dnf install prints far more than anyone needs in memory.
  return { ...opts, timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, signal: opts.signal ?? signal, buffer: opts.buffer ?? false, onLine };
}

/** `ctx.shell` that writes the job log: what a technician reads in `pvx jobs log`. */
export function withJobLog(shell: Shell, say: Say, signal: AbortSignalLike): Shell {
  return {
    run: (command, args = [], opts) => shell.run(command, args, loggedOpts(say, signal, command, args, opts)),
    must: (command, args = [], opts) => shell.must(command, args, loggedOpts(say, signal, command, args, opts)),
    ok: (command, args = [], opts) => shell.ok(command, args, loggedOpts(say, signal, command, args, opts)),
  };
}
