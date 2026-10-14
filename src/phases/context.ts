// What every phase receives, and the small helpers more than one phase uses.
import type { ModuleFs, Store } from "@pvx/sdk";
import type { Credentials } from "../credentials.ts";
import type { DnfState } from "../dnf.ts";
import { applyDnfLine, endDnfRun, recordFailure } from "../dnf.ts";
import type { RunOptions } from "../state.ts";
import type { ProgressStore } from "../progress-store.ts";
import type { Say, Shell } from "../exec.ts";
import { StepError } from "../exec.ts";

export interface InstallPaths {
  /** The module's `assets/` dir (the `.repo` files, `control_panel/`). */
  assets: string;
  stateDir: string;
}

export interface Passwords {
  sql: string;
  web: string;
}

/** The credentials file of this install: where it lives and what it holds (the passwords included, so never log it). */
export interface CredentialsFile {
  path: string;
  data: Credentials;
}

export interface PhaseContext {
  options: RunOptions;
  /** Never logged, never in the store. */
  passwords: Passwords;
  credentials: CredentialsFile;
  shell: Shell;
  fs: ModuleFs;
  store: Store;
  say: Say;
  dnf: DnfState;
  progress: ProgressStore;
  paths: InstallPaths;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const MINUTE_MS = 60_000;
/** A `dnf install` of the whole Issabel set can take the better part of an hour on a slow mirror. */
export const PACKAGE_TIMEOUT_MS = 60 * MINUTE_MS;
export const SHORT_TIMEOUT_MS = 5 * MINUTE_MS;

/** Runs one `dnf install -y` and feeds its output to the package progress. Returns whether it worked. */
export async function dnfInstall(context: PhaseContext, names: string[]): Promise<boolean> {
  const onLine = (line: string) => {
    if (applyDnfLine(context.dnf, line)) context.progress.touch();
  };
  const result = await context.shell.run("dnf", ["install", "-y", ...names], { timeoutMs: PACKAGE_TIMEOUT_MS, onLine });
  endDnfRun(context.dnf, result.code === 0);
  context.progress.save();
  return result.code === 0;
}

/** Installs the names in one batch; if the batch fails, one by one, so the failures can be listed. Throws when any failed. */
export async function installOrFail(context: PhaseContext, names: string[]): Promise<void> {
  if (!names.length || (await dnfInstall(context, names))) return;
  context.say.warning("o lote falhou: tentando pacote a pacote para listar as falhas");
  const failed: string[] = [];
  for (const name of names) if (!(await dnfInstall(context, [name]))) failed.push(name);
  failed.forEach((name) => recordFailure(context.dnf, name));
  context.progress.save();
  if (failed.length) throw new StepError(`falha ao instalar pacote(s): ${failed.join(", ")}`, `dnf install -y ${failed.join(" ")}`, 1, [`No match or failure for: ${failed.join(", ")}`]);
}

/** A step whose failure is worth a warning, not a stop. */
export async function attempt(context: PhaseContext, what: string, step: () => Promise<boolean>): Promise<void> {
  if (!(await step())) context.say.warning(`${what}: falhou, seguindo em frente`);
}
