// Progress records a test can inject, shaped like what the job writes.
import { PHASE_IDS, type NetinstallProgress, type PackageRef, type PhaseId, type PhaseRecord } from "../src/model.ts";
import { DEFAULT_OPTIONS } from "../src/options.ts";

export const NOW = Date.now();
const MINUTE = 60_000;

const pkg = (name: string, version = "1.0-1.el8"): PackageRef => ({ name, version, arch: "x86_64", repo: "baseos", size: "120 k" });
export const donePackages = (count: number): PackageRef[] => Array.from({ length: count }, (_, index) => pkg(`pacote-${index + 1}`));

const phases = (states: Partial<Record<PhaseId, PhaseRecord["state"]>>): PhaseRecord[] =>
  PHASE_IDS.map((id, index) => {
    const state = states[id] ?? "pending";
    return { id, state, startedAt: state === "pending" ? undefined : NOW - (12 - index) * MINUTE, endedAt: state === "done" ? NOW - (11 - index) * MINUTE : undefined };
  });

/** In the package phase: 96 of 181 installed, three running, one failure to retry. */
export function installing(credentialsFile?: string): NetinstallProgress {
  return {
    phase: "packages",
    phases: phases({ repos: "done", prepare: "done", php: "done", packages: "running" }),
    packages: {
      total: 181,
      done: donePackages(96),
      running: [
        { ...pkg("php-imap", "7.4.33-1.el8.remi"), stage: "downloading" },
        { ...pkg("issabel-pbx", "5.0.0-1.el8"), stage: "installing" },
        { ...pkg("asterisk18-sip", "18.20.2-1.el8"), stage: "configuring" },
      ],
      failed: ["wanpipe-utils"],
    },
    startedAt: NOW - 12 * MINUTE,
    runStartedAt: NOW - 12 * MINUTE,
    options: DEFAULT_OPTIONS,
    credentialsFile,
  };
}

/** Stopped at the database phase: everything before it done. */
export function failedAtDatabase(credentialsFile?: string): NetinstallProgress {
  return {
    phase: "database",
    phases: phases({ repos: "done", prepare: "done", php: "done", packages: "done", post: "done", database: "failed" }),
    packages: { total: 181, done: donePackages(181), running: [], failed: [] },
    startedAt: NOW - 19 * MINUTE,
    runStartedAt: NOW - 19 * MINUTE,
    options: DEFAULT_OPTIONS,
    credentialsFile,
    error: {
      phase: "database",
      command: "install_amp --dbuser=root --installdb --scripted --language=en",
      code: 1,
      output: ["ERROR 1045 (28000): Access denied for user 'root'@'localhost'"],
      cause: "a senha do MySQL não foi aplicada na fase anterior",
    },
  };
}

/** Everything but the reboot done. */
export function finished(credentialsFile?: string, options = DEFAULT_OPTIONS): NetinstallProgress {
  return {
    phase: "reboot",
    phases: phases({ repos: "done", prepare: "done", php: "done", packages: "done", post: "done", database: "done", panel: "done", timezone: "done", passwords: "done", reboot: "running" }),
    packages: { total: 181, done: donePackages(181), running: [], failed: [] },
    startedAt: NOW - 20 * MINUTE,
    runStartedAt: NOW - 20 * MINUTE,
    options,
    credentialsFile,
  };
}

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
