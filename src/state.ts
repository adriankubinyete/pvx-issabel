// Shapes that are persisted (the module store) or shared between the job and the page. One interface per persisted format.

export const JOB_NAME = "netinstall";

/** The store keys this module writes; the phases have their own (`phases:netinstall`, written by `ctx.phases`). Each key has a type
 * below; nothing else is persisted. The reboot plan has its own key: the job writes it and `netinstall reboot` / `postpone` answer
 * it from another process. */
export const STORE_KEY = { install: "install", packages: "packages", reboot: "reboot" } as const;

/** The phase that waits for the restart: the install is complete before it, so the done screen shows during its countdown. */
export const REBOOT_PHASE = "reboot";

/** The expected total duration of a whole install, for the ETA of the global bar. */
export const EXPECTED_INSTALL_MS = 20 * 60_000;

export type AddonKey = "licensed" | "community-blocklist" | "wanpipe";
export type AsteriskVersion = "16" | "18";

/** What an install is told to do. Holds no secret: it is persisted with the install. */
export interface RunOptions {
  astver: AsteriskVersion;
  addpkgs: AddonKey[];
  timezone: string;
  force: boolean;
  skipClean: boolean;
  reboot: boolean;
}

export type RebootChoice = "wait" | "now" | "postponed";
export interface RebootPlan {
  /** ms since epoch: when the central restarts by itself. */
  at: number;
  choice: RebootChoice;
}

/** What the install was asked to do and where its passwords are. The phases and the packages have their own keys. */
export interface InstallState {
  options: RunOptions;
  /** Path of the 0600 file with the passwords (never the passwords themselves). */
  credentialsFile?: string;
}
