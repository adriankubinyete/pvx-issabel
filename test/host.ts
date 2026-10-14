// Helpers for the tests that run the module through the real host: jobs started by the host API run in a detached process
// (`job-main.ts` stands in for the pvx binary) that loads the fixture module, which has a fake machine.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jobsConfig, jobsDir } from "@pvx/core";
import type { NetinstallProgress, RebootPlan } from "../src/model.ts";

export const FIXTURE = join(import.meta.dir, "fixture");
export const SQL_SECRET = "SqlSecretPassw0rdXyzAbcd1";
export const WEB_SECRET = "WebSecretPassw0rdQrsTuvw2";
export const SECRETS = { "sql-password": SQL_SECRET, "web-password": WEB_SECRET };

const saved = { ...jobsConfig };
const KNOBS = ["ISSABEL_FAKE_DELAY_MS", "ISSABEL_FAKE_FAIL_AT", "ISSABEL_FAKE_PRESENT"];

/** Points the host at the stand-in binary and the detached (no systemd) path. Call `restoreHost` in `afterEach`. */
export function useDetachedJobs(): void {
  jobsConfig.selfCmd = () => [process.execPath, join(import.meta.dir, "job-main.ts")];
  jobsConfig.systemd = () => false;
}

export function restoreHost(): void {
  Object.assign(jobsConfig, saved);
  for (const knob of KNOBS) delete process.env[knob];
}

export const stateDirOf = (home: string) => join(home, "modules", "issabel", "state");

/** What a test writes to stand in for a job and its progress (no process runs). */
export interface Injected {
  progress?: NetinstallProgress;
  reboot?: RebootPlan;
  /** The job as the host reads it. `pid` defaults to the test's own, so "running" stays running: never stop such a job (the host signals the pid's group). */
  job?: { state: "running" | "done" | "failed" | "stopped"; startedAt: number; pid?: number };
  log?: string[];
  /** Text of a credentials file (its path is `progress.credentialsFile`). */
  credentials?: string;
}

export function inject(home: string, data: Injected): void {
  mkdirSync(stateDirOf(home), { recursive: true });
  writeFileSync(join(stateDirOf(home), "state.json"), JSON.stringify({ progress: data.progress, reboot: data.reboot }));
  if (data.credentials && data.progress?.credentialsFile) writeFileSync(data.progress.credentialsFile, data.credentials, { mode: 0o600 });
  if (!data.job) return;
  const dir = jobsDir("issabel");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "netinstall.json"), JSON.stringify({ pid: process.pid, ...data.job, line: "netinstall run" }));
  writeFileSync(join(dir, "netinstall.log"), (data.log ?? []).map((line) => `${line}\n`).join(""));
}

/** Polls by time (the page reads the job and the queries on timers). */
export async function until<T>(read: () => Promise<T> | T, done: (value: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > end) throw new Error(`tempo esgotado esperando: ${JSON.stringify(value).slice(0, 600)}`);
    await Bun.sleep(40);
  }
}
