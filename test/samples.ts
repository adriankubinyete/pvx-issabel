// What a test injects to stand in for a job and its install, shaped like what the job writes: the phases (`ctx.phases`), the install and the
// packages (the module store).
import type { PackageProgress, PackageRef, PhaseRecord, PhasesState } from "@pvx/sdk";
import { DEFAULT_OPTIONS } from "../src/options.ts";
import { PHASES } from "../src/phases/index.ts";
import type { InstallState } from "../src/state.ts";

export const NOW = Date.now();
const MINUTE = 60_000;

export interface Sample {
  phases: PhasesState;
  install: InstallState;
  packages: PackageProgress;
}

const pkg = (name: string, version = "1.0-1.el8"): PackageRef => ({ name, version, arch: "x86_64", repo: "baseos", size: "120 k" });
export const donePackages = (count: number): PackageRef[] => Array.from({ length: count }, (_, index) => pkg(`pacote-${index + 1}`));

const recordsOf = (states: Record<string, PhaseRecord["state"]>): PhaseRecord[] =>
  PHASES.map((phase, index) => {
    const state = states[phase.id] ?? "pending";
    return {
      id: phase.id,
      label: phase.label,
      weight: phase.weight,
      state,
      startedAt: state === "pending" ? undefined : NOW - (12 - index) * MINUTE,
      endedAt: state === "done" ? NOW - (11 - index) * MINUTE : undefined,
    };
  });

const sampleOf = (startedMinutesAgo: number, states: Record<string, PhaseRecord["state"]>, packages: PackageProgress, credentialsFile?: string, options = DEFAULT_OPTIONS): Sample => {
  const startedAt = NOW - startedMinutesAgo * MINUTE;
  return { phases: { phases: recordsOf(states), startedAt, runStartedAt: startedAt }, install: { options, credentialsFile }, packages };
};

const allDone = (count: number): PackageProgress => ({ total: count, done: donePackages(count), running: [], failed: [] });

/** In the package phase: 96 of 181 installed, three running, one failure to retry. */
export const installing = (credentialsFile?: string): Sample =>
  sampleOf(12, { repos: "done", prepare: "done", php: "done", packages: "running" }, {
    total: 181,
    done: donePackages(96),
    running: [
      { ...pkg("php-imap", "7.4.33-1.el8.remi"), phase: "download" },
      { ...pkg("issabel-pbx", "5.0.0-1.el8"), phase: "install" },
      { ...pkg("asterisk18-sip", "18.20.2-1.el8"), phase: "verify" },
    ],
    failed: ["wanpipe-utils"],
  }, credentialsFile);

/** Stopped at the database phase: everything before it done. */
export function failedAtDatabase(credentialsFile?: string): Sample {
  const sample = sampleOf(19, { repos: "done", prepare: "done", php: "done", packages: "done", post: "done", database: "failed" }, allDone(181), credentialsFile);
  sample.phases.failure = {
    phase: "database",
    message: "install_amp --dbuser=root --installdb --scripted --language=en saiu com código 1",
    command: "install_amp --dbuser=root --installdb --scripted --language=en",
    code: 1,
    output: ["ERROR 1045 (28000): Access denied for user 'root'@'localhost'"],
  };
  return sample;
}

const FINISHED_STATES = { repos: "done", prepare: "done", php: "done", packages: "done", post: "done", database: "done", panel: "done", timezone: "done", passwords: "done", reboot: "running" } as const;

/** Everything but the reboot done. */
export const finished = (credentialsFile?: string, options = DEFAULT_OPTIONS): Sample => sampleOf(20, FINISHED_STATES, allDone(181), credentialsFile, options);

export const CREDENTIALS_TEXT = [
  "produto=issabel5",
  "data=2026-10-14T15:21:00.000Z",
  "url=https://203.0.113.10",
  "usuario_web=admin",
  "senha_web=Xq7mP2vLr9tKa4sWz8nBc3yE",
  "usuario_mysql=root",
  "senha_mysql_root=Hd5uR1fJk6pZq9wTm2xNv7sA",
  "asterisk=18",
  "pacotes_extras=licenciados,blocklist",
  "",
].join("\n");

export const LOG_LINES = [
  "i fase pacotes: iniciando",
  "$ dnf install -y httpd httpd-tools",
  "  Running scriptlet: issabel-framework-5.0.0",
  "  Verifying        : asterisk18-core-18.20.2-1.el8",
  "  Installing       : php-imap-7.4.33-1.el8.remi",
];
