// The install itself: sets up a fresh run or a resume, hands the phases their context and lets `ctx.phases` record what happens. The
// command context comes in as an argument, so the tests run it end to end against a fake one.
import type { CommandCtx, ErrorsKit, PackageProgress, PackagesKit, PhasesResult } from "@pvx/sdk";
import { credentialsPath, newCredentials, parseCredentials, saveCredentials } from "./credentials.ts";
import { toError } from "./errors.ts";
import { sayOf } from "./exec.ts";
import { createPackageWall } from "./package-wall.ts";
import { JOB_NAME, STORE_KEY, type InstallState, type RunOptions } from "./state.ts";
import { phaseDefsOf } from "./phases/index.ts";
import { rebootNow, rebootRequested } from "./phases/reboot.ts";
import type { BaseContext, InstallPaths, Passwords, PhaseContext } from "./phases/context.ts";

const SHELL_TIMEOUT_MS = 5 * 60_000;

/** What the install needs besides the command context: where its files are, the clock, the tracker of dnf output and the error kit. */
export interface InstallEnv {
  paths: InstallPaths;
  packages: PackagesKit;
  errors: ErrorsKit;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export type InstallRequest = { mode: "fresh"; options: RunOptions; passwords: Passwords } | { mode: "resume" };
export type InstallOutcome = PhasesResult | { ok: false; failedPhase?: undefined; error: Error };

interface Prepared {
  options: RunOptions;
  passwords: Passwords;
  credentials: PhaseContext["credentials"];
  /** What a resume keeps of the package wall; a fresh run starts with none. */
  packages?: PackageProgress;
}

/** A fresh run writes the credentials file first (0600): a resume has no other way to get the passwords back. */
async function prepareFresh(ctx: CommandCtx, env: InstallEnv, request: Extract<InstallRequest, { mode: "fresh" }>): Promise<Prepared> {
  const { options, passwords } = request;
  const when = new Date(env.now());
  const credentials = { path: credentialsPath(when, env.paths.stateDir), data: newCredentials(options, passwords, when) };
  await saveCredentials(ctx.fs, credentials.path, credentials.data);
  const install: InstallState = { options, credentialsFile: credentials.path };
  ctx.store.set(STORE_KEY.install, install);
  ctx.store.delete(STORE_KEY.packages);
  ctx.store.delete(STORE_KEY.reboot);
  return { options, passwords, credentials };
}

/** A package that was running when the job died is redone, and an earlier failure is tried again. */
function packagesToResume(saved: PackageProgress | undefined): PackageProgress | undefined {
  if (!saved) return undefined;
  return { ...saved, running: [], failed: [] };
}

async function prepareResumed(ctx: CommandCtx): Promise<Prepared> {
  const install = ctx.store.get<InstallState>(STORE_KEY.install);
  if (!install) throw new Error("não há instalação para continuar: rode `issabel netinstall`");
  const path = install.credentialsFile;
  const data = path ? parseCredentials(await ctx.fs.read(path).catch(() => "")) : undefined;
  if (!path || !data) throw new Error("não achei o arquivo de credenciais da instalação: não dá para continuar; comece de novo com --force");
  const passwords = { sql: data.mysqlPassword, web: data.webPassword };
  return { options: install.options, passwords, credentials: { path, data }, packages: packagesToResume(ctx.store.get<PackageProgress>(STORE_KEY.packages)) };
}

function prepare(ctx: CommandCtx, env: InstallEnv, request: InstallRequest): Promise<Prepared> {
  return request.mode === "fresh" ? prepareFresh(ctx, env, request) : prepareResumed(ctx);
}

function contextOf(ctx: CommandCtx, env: InstallEnv, prepared: Prepared): BaseContext {
  const say = sayOf(ctx);
  const tracker = env.packages.tracker("dnf", prepared.packages);
  return {
    options: prepared.options,
    passwords: prepared.passwords,
    credentials: prepared.credentials,
    shell: ctx.shell.echoing({ timeoutMs: SHELL_TIMEOUT_MS }),
    fs: ctx.fs,
    store: ctx.store,
    say,
    errors: env.errors,
    packages: createPackageWall(ctx.store, tracker, env.now),
    paths: env.paths,
    now: env.now,
    sleep: env.sleep,
  };
}

/** Runs the phases (all of them, or the unfinished ones of a resume) and, when the last phase asks for it, restarts the central. */
export async function executeInstall(ctx: CommandCtx, env: InstallEnv, request: InstallRequest): Promise<InstallOutcome> {
  let prepared: Prepared;
  try {
    prepared = await prepare(ctx, env, request);
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
  const context = contextOf(ctx, env, prepared);
  const result = await ctx.phases.run(JOB_NAME, phaseDefsOf(context), { fresh: request.mode === "fresh" });
  if (result.ok && rebootRequested(ctx.phases.state(JOB_NAME))) await rebootNow(context);
  return result;
}
