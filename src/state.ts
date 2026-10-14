// Shapes that are persisted (the module store) or shared between the job and the page. One interface per persisted format.

export const JOB_NAME = "netinstall";

/** The store keys this module writes. Each one has a type below; nothing else is persisted. The reboot plan has its own key: the job
 * writes it and `netinstall reboot` / `postpone` answer it from another process. */
export const STORE_KEY = { progress: "progress", reboot: "reboot" } as const;

export const PHASE_IDS = ["repos", "prepare", "php", "packages", "post", "database", "panel", "timezone", "passwords", "reboot"] as const;
export type PhaseId = (typeof PHASE_IDS)[number];
export type PhaseState = "pending" | "running" | "done" | "failed" | "skipped";

export const PHASE_LABEL: Record<PhaseId, string> = {
  repos: "repositórios",
  prepare: "preparo do sistema",
  php: "PHP 7.4 (Remi)",
  packages: "pacotes",
  post: "pós-instalação",
  database: "banco do IssabelPBX",
  panel: "painel do operador",
  timezone: "fuso horário",
  passwords: "senhas",
  reboot: "reiniciar",
};

/** Share of the whole install each phase takes, for the global bar. Rough: the package phase is most of it. */
export const PHASE_WEIGHT: Record<PhaseId, number> = {
  repos: 4,
  prepare: 1,
  php: 3,
  packages: 70,
  post: 3,
  database: 6,
  panel: 2,
  timezone: 1,
  passwords: 5,
  reboot: 5,
};

/** The expected total duration of a whole install, for the ETA of the global bar. */
export const EXPECTED_INSTALL_MS = 20 * 60_000;

export type AddonKey = "licensed" | "community-blocklist" | "wanpipe";
export type AsteriskVersion = "16" | "18";

/** What an install is told to do. Holds no secret: it is persisted with the progress. */
export interface RunOptions {
  astver: AsteriskVersion;
  addpkgs: AddonKey[];
  timezone: string;
  force: boolean;
  skipClean: boolean;
  reboot: boolean;
}

export interface PhaseRecord {
  id: PhaseId;
  state: PhaseState;
  startedAt?: number;
  endedAt?: number;
  /** A short note of the outcome ("adiado", a warning count). */
  detail?: string;
}

export interface PackageRef {
  name: string;
  version: string;
  arch?: string;
  repo?: string;
  size?: string;
}
export type PackageStage = "downloading" | "installing" | "configuring";
export interface RunningPackage extends PackageRef {
  stage: PackageStage;
}
export interface PackageProgress {
  total: number;
  done: PackageRef[];
  running: RunningPackage[];
  /** Names (or `name-version` when only that was printed). */
  failed: string[];
}

/** Why a phase stopped, for the failed screen. */
export interface FailureInfo {
  phase: PhaseId;
  command: string;
  code?: number;
  /** The last output lines that matter. */
  output: string[];
  cause: string;
}

export type RebootChoice = "wait" | "now" | "postponed";
export interface RebootPlan {
  /** ms since epoch: when the central restarts by itself. */
  at: number;
  choice: RebootChoice;
}

export interface NetinstallProgress {
  /** The phase running now, or the one that failed. */
  phase?: PhaseId;
  phases: PhaseRecord[];
  packages: PackageProgress;
  /** When the install began (kept across resumes: the global bar counts from it). */
  startedAt: number;
  /** When the job that is writing this progress began; a resume sets it again. It tells a stale progress from a current one. */
  runStartedAt: number;
  options: RunOptions;
  /** Path of the 0600 file with the passwords (never the passwords themselves). */
  credentialsFile?: string;
  error?: FailureInfo;
}

export type NetinstallView = "running" | "failed" | "done";
