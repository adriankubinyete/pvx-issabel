// The install itself: sets up a fresh run or a resume, hands the phases their context and records what happens. It takes its
// dependencies as arguments (exec, fs, store, clock), so the tests run it end to end against a fake system.
import type { AbortSignalLike, ModuleFs, Store } from "@pvx/sdk";
import { credentialsPath, newCredentials, parseCredentials, saveCredentials } from "./credentials.ts";
import { createDnfState } from "./dnf.ts";
import { toError } from "./errors.ts";
import { failureOf } from "./failure.ts";
import { PROGRESS_KEY, REBOOT_KEY, type NetinstallProgress, type PhaseId, type RunOptions } from "./model.ts";
import { PHASES } from "./phases/index.ts";
import { rebootNow, rebootRequested } from "./phases/reboot.ts";
import type { InstallPaths, Passwords, PhaseContext } from "./phases/context.ts";
import { failPhase, finishPhase, isPhaseFinished, newProgress, prepareResume, skipPhase, startPhase } from "./progress.ts";
import { createProgressStore, type ProgressStore } from "./progress-store.ts";
import { runPhases, type PhaseHooks, type RunResult } from "./runner.ts";
import { createShell, type ExecFn, type Say } from "./runtime.ts";

export interface InstallDeps {
  exec: ExecFn;
  fs: ModuleFs;
  store: Store;
  say: Say;
  paths: InstallPaths;
  signal: AbortSignalLike;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export type InstallRequest = { mode: "fresh"; options: RunOptions; passwords: Passwords } | { mode: "resume" };
export type InstallOutcome = RunResult<PhaseId> | { ok: false; failedPhase?: undefined; error: Error };

const hooksFor = (progress: ProgressStore, now: () => number): PhaseHooks<PhaseId> => ({
  isFinished: (id) => isPhaseFinished(progress.progress, id),
  started(id) {
    startPhase(progress.progress, id, now());
    progress.save();
  },
  finished(id, detail) {
    finishPhase(progress.progress, id, now(), detail);
    progress.save();
  },
  skipped(id, reason) {
    skipPhase(progress.progress, id, reason);
    progress.save();
  },
  failed(id, error) {
    failPhase(progress.progress, id, now(), failureOf(id, error));
    progress.save();
  },
});

interface Prepared {
  progress: NetinstallProgress;
  passwords: Passwords;
  credentialsFile: PhaseContext["credentials"];
}

/** A fresh run writes the credentials file first (0600): a resume has no other way to get the passwords back. */
async function prepareFresh(deps: InstallDeps, request: Extract<InstallRequest, { mode: "fresh" }>, progress: NetinstallProgress): Promise<Prepared> {
  const { options, passwords } = request;
  const when = new Date(deps.now());
  const credentialsFile = { path: credentialsPath(when, deps.paths.stateDir), data: newCredentials(options, passwords, when) };
  progress.credentialsFile = credentialsFile.path;
  deps.store.delete(REBOOT_KEY);
  await saveCredentials(createShell(deps.exec, deps.say, deps.signal), deps.fs, credentialsFile.path, credentialsFile.data);
  return { progress, passwords, credentialsFile };
}

async function prepareResumed(deps: InstallDeps, progress: NetinstallProgress): Promise<Prepared> {
  const path = progress.credentialsFile;
  const data = path ? parseCredentials(await deps.fs.read(path).catch(() => "")) : undefined;
  if (!path || !data) throw new Error("não achei o arquivo de credenciais da instalação: não dá para continuar; comece de novo com --force");
  prepareResume(progress, deps.now());
  return { progress, passwords: { sql: data.mysqlPassword, web: data.webPassword }, credentialsFile: { path, data } };
}

function prepare(deps: InstallDeps, request: InstallRequest): Promise<Prepared> {
  if (request.mode === "fresh") return prepareFresh(deps, request, newProgress(request.options, deps.now()));
  const saved = deps.store.get<NetinstallProgress>(PROGRESS_KEY);
  if (!saved) throw new Error("não há instalação para continuar: rode `issabel netinstall`");
  return prepareResumed(deps, saved);
}

function contextOf(deps: InstallDeps, prepared: Prepared, progress: ProgressStore): PhaseContext {
  return {
    options: prepared.progress.options,
    passwords: prepared.passwords,
    credentials: prepared.credentialsFile,
    shell: createShell(deps.exec, deps.say, deps.signal),
    fs: deps.fs,
    store: deps.store,
    say: deps.say,
    dnf: createDnfState(prepared.progress.packages),
    progress,
    paths: deps.paths,
    now: deps.now,
    sleep: deps.sleep,
  };
}

/** Runs the phases (all of them, or the unfinished ones of a resume) and, when the last phase asks for it, restarts the central. */
export async function executeInstall(deps: InstallDeps, request: InstallRequest): Promise<InstallOutcome> {
  let prepared: Prepared;
  try {
    prepared = await prepare(deps, request);
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
  const progress = createProgressStore(deps.store, prepared.progress, deps.now);
  progress.save();
  const context = contextOf(deps, prepared, progress);
  const result = await runPhases(PHASES, context, hooksFor(progress, deps.now), deps.say);
  if (result.ok && rebootRequested(prepared.progress)) await rebootNow(context);
  return result;
}
