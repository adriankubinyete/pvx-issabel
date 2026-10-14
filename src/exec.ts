// What the install code runs on: the injected exec and fs, a `Say` that writes to the output and the job log, and a `Shell`
// over exec that streams every output line, keeps the tail for the failure screen and turns a bad exit into a `StepError`.
import type { AbortSignalLike, CommandCtx, ExecOpts, ExecResult, ModuleFs } from "@pvx/sdk";

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

export interface RunOpts {
  timeoutMs?: number;
  stdin?: string;
  /** Sees every output line (the dnf reader). */
  onLine?: (line: string) => void;
  /** What to show for the command instead of its argv, when the argv holds a secret. */
  display?: string;
  /** Keep stdout and stderr in the result (default: only streamed, since dnf output is huge). */
  buffer?: boolean;
}

/** An exec result plus the lines that came out of it that are worth keeping. */
export interface ShellResult extends ExecResult {
  tail: string[];
}

export interface Shell {
  /** Never throws on a bad exit: a program that cannot start answers 127. */
  run(command: string, args: string[], opts?: RunOpts): Promise<ShellResult>;
  /** Like `run`, but a bad exit throws a `StepError`. */
  must(command: string, args: string[], opts?: RunOpts): Promise<ShellResult>;
  /** True when the exit was 0. */
  ok(command: string, args: string[], opts?: RunOpts): Promise<boolean>;
}

export class StepError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly code: number | undefined,
    readonly output: string[],
  ) {
    super(message);
  }
}

export const NOT_FOUND_CODE = 127;
const COMMAND_WIDTH = 110;
const TAIL_LINES = 40;
const OUTPUT_LINES = 6;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
/** A dnf progress redraw (`45% [====   ]`) says nothing worth keeping for a failure. */
const PROGRESS_REDRAW = /\d+%\s*\[|\[=*\s*\]|ETA\s*$/;
const ERROR_LINE = /error|fail|denied|cannot|unable|no match|no space/i;

/** `dnf install -y a b c…` cut to a width the screen can show. */
export function describeCommand(command: string, args: string[]): string {
  const text = [command, ...args].join(" ");
  return text.length > COMMAND_WIDTH ? `${text.slice(0, COMMAND_WIDTH - 1)}…` : text;
}

/** The lines of a failure worth showing: the ones that name an error, else the last ones. */
export function relevantOutput(tail: string[]): string[] {
  const errors = tail.filter((line) => ERROR_LINE.test(line));
  return (errors.length ? errors : tail).slice(-OUTPUT_LINES);
}

export function createShell(exec: ExecFn, say: Say, signal: AbortSignalLike): Shell {
  const run: Shell["run"] = async (command, args, opts = {}) => {
    const shown = opts.display ?? describeCommand(command, args);
    say.raw(`$ ${shown}`);
    const tail: string[] = [];
    const onLine: ExecOpts["onLine"] = (line) => {
      if (!line.trim()) return;
      say.raw(line);
      opts.onLine?.(line);
      if (!PROGRESS_REDRAW.test(line)) tail.push(line.trim());
      if (tail.length > TAIL_LINES) tail.shift();
    };
    const result = await exec(command, args, { timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, stdin: opts.stdin, onLine, signal, buffer: opts.buffer ?? false }).catch(
      (error: Error): ExecResult => ({ code: NOT_FOUND_CODE, stdout: "", stderr: String(error.message) }),
    );
    if (result.code === NOT_FOUND_CODE && result.stderr) tail.push(result.stderr);
    return { ...result, tail };
  };
  const must: Shell["must"] = async (command, args, opts) => {
    const result = await run(command, args, opts);
    if (result.code === 0) return result;
    const shown = opts?.display ?? describeCommand(command, args);
    throw new StepError(`${shown} saiu com código ${result.code}`, shown, result.code, relevantOutput(result.tail));
  };
  const ok: Shell["ok"] = async (command, args, opts) => (await run(command, args, opts)).code === 0;
  return { run, must, ok };
}
