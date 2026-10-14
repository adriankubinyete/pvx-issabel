// Reads the output of `dnf install` line by line into per-package progress. Pure: no exec, fs or store.
// `applyDnfLine` mutates the state it is given (hundreds of lines a second must not copy 180 packages each time) and says
// whether anything the page shows changed. A `\r` progress redraw arrives as its own line: it only ever (re)marks a package
// as downloading, never as done.
import type { PackageProgress, PackageRef, PackageStage } from "./model.ts";

type Section = "none" | "table" | "failed";

export interface DnfState {
  packages: PackageProgress;
  /** Name -> details, from the "Dependencies resolved" table. */
  known: Record<string, PackageRef>;
  /** Totals of the dnf runs that ended well. */
  committed: number;
  /** Total of the run in progress, from its "Transaction Summary". */
  current: number;
  section: Section;
  /** A long package name that wrapped onto its own line in the table. */
  wrapped?: string;
}

export const emptyPackages = (): PackageProgress => ({ total: 0, done: [], running: [], failed: [] });

export const createDnfState = (packages: PackageProgress = emptyPackages()): DnfState => ({
  packages,
  known: {},
  committed: packages.done.length,
  current: 0,
  section: "none",
});

const ARCHES = new Set(["x86_64", "noarch", "i686", "i386", "aarch64", "ppc64le", "s390x", "src"]);

/** `php-imap-7.4.33-1.el8.remi.x86_64(.rpm)` -> name, version-release, arch. A plain name comes back as itself. */
export function splitNevra(text: string): PackageRef {
  const bare = text.replace(/\.rpm$/, "");
  const dot = bare.lastIndexOf(".");
  const arch = dot > 0 && ARCHES.has(bare.slice(dot + 1)) ? bare.slice(dot + 1) : undefined;
  const withoutArch = arch ? bare.slice(0, dot) : bare;
  const parts = withoutArch.split("-");
  if (parts.length < 3 || !/^\d|^\d+:/.test(parts[parts.length - 2] ?? "")) return { name: withoutArch, version: "", arch };
  const release = parts.pop()!;
  const version = parts.pop()!;
  return { name: parts.join("-"), version: `${version}-${release}`, arch };
}

const SUMMARY_LINE = /^(?:Install|Upgrade|Reinstall|Downgrade)\s+(\d+)\s+Packages?\b/;
const TABLE_SECTION = /^(?:Installing|Upgrading|Reinstalling|Downgrading)(?: dependencies| weak dependencies| group\/module packages)?:$/;
const OTHER_SECTION = /^[A-Z][A-Za-z ]+:$/;
const TABLE_ROW = /^\s?(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+([\d.]+ \S+)\s*$/;
const WRAPPED_NAME = /^\s?(\S+)\s*$/;
const WRAPPED_ROW = /^\s+(\S+)\s+(\S+)\s+(\S+)\s+([\d.]+ \S+)\s*$/;
const DOWNLOAD_LINE = /^\((?:\d+-)?\d+\/\d+\): (\S+?)\.rpm\s+(.*)$/;
const DOWNLOAD_DONE = /\|\s*[\d.]+ \S+\s+\d\d:\d\d\s*$/;
const TRANSACTION_LINE = /^\s*(Installing|Upgrading|Reinstalling|Downgrading|Running scriptlet|Verifying)\s*:\s*(\S+)\s+\d+\/\d+\s*$/;
const NO_MATCH = /^Error: Unable to find a match: (.+)$/;
const NO_MATCH_ARGUMENT = /^No match for argument: (\S+)/;
const SCRIPTLET_ERROR = /^Error (?:in \w+ scriptlet in rpm package|unpacking rpm package) (\S+)/;
const FAILED_HEADER = /^Failed:$/;
const RUNNING_TRANSACTION = /^Running transaction\s*$/;

const nameOf = (text: string) => splitNevra(text).name;
const refOf = (state: DnfState, nevra: string): PackageRef => {
  const parsed = splitNevra(nevra);
  return state.known[parsed.name] ?? parsed;
};

const dropRunning = (state: DnfState, name: string) => {
  state.packages.running = state.packages.running.filter((pkg) => pkg.name !== name);
};
const setRunning = (state: DnfState, ref: PackageRef, stage: PackageStage) => {
  dropRunning(state, ref.name);
  state.packages.running.push({ ...ref, stage });
};
const markFailed = (state: DnfState, name: string) => {
  dropRunning(state, name);
  if (!state.packages.failed.includes(name)) state.packages.failed.push(name);
};
const markDone = (state: DnfState, ref: PackageRef) => {
  dropRunning(state, ref.name);
  state.packages.failed = state.packages.failed.filter((name) => name !== ref.name);
  if (!state.packages.done.some((pkg) => pkg.name === ref.name)) state.packages.done.push({ name: ref.name, version: ref.version, arch: ref.arch, repo: ref.repo, size: ref.size });
};
/** The transaction is sequential: a package that is no longer the one being installed is finished. */
const finishInstalling = (state: DnfState) => {
  for (const pkg of state.packages.running.filter((running) => running.stage !== "downloading")) markDone(state, pkg);
};

const syncTotal = (state: DnfState) => {
  const seen = state.packages.done.length + state.packages.failed.length + state.packages.running.length;
  state.packages.total = Math.max(state.committed + state.current, seen);
};

function readSummary(state: DnfState, line: string): boolean {
  const match = SUMMARY_LINE.exec(line);
  if (!match) return false;
  state.current += Number(match[1]);
  state.section = "none";
  return true;
}

function readSectionHeader(state: DnfState, line: string): boolean {
  if (TABLE_SECTION.test(line)) state.section = "table";
  else if (OTHER_SECTION.test(line) && state.section === "table") state.section = "none";
  else return false;
  state.wrapped = undefined;
  return true;
}

function readTableRow(state: DnfState, line: string): boolean {
  if (state.section !== "table") return false;
  const row = state.wrapped ? WRAPPED_ROW.exec(line) : TABLE_ROW.exec(line);
  if (row && state.wrapped) {
    state.known[state.wrapped] = { name: state.wrapped, arch: row[1], version: row[2]!, repo: row[3], size: row[4] };
    state.wrapped = undefined;
    return true;
  }
  if (row) {
    state.known[row[1]!] = { name: row[1]!, arch: row[2], version: row[3]!, repo: row[4], size: row[5] };
    return true;
  }
  const alone = WRAPPED_NAME.exec(line);
  if (alone && !line.startsWith("=")) state.wrapped = alone[1];
  return false;
}

function readDownload(state: DnfState, line: string): boolean {
  const match = DOWNLOAD_LINE.exec(line);
  if (!match) return false;
  const ref = refOf(state, match[1]!);
  if (DOWNLOAD_DONE.test(match[2]!)) dropRunning(state, ref.name);
  else setRunning(state, ref, "downloading");
  return true;
}

function readTransactionStart(state: DnfState, line: string): boolean {
  if (!RUNNING_TRANSACTION.test(line)) return false;
  state.packages.running = state.packages.running.filter((pkg) => pkg.stage !== "downloading");
  return true;
}

const INSTALL_ACTIONS = new Set(["Installing", "Upgrading", "Reinstalling", "Downgrading"]);

function readTransactionLine(state: DnfState, line: string): boolean {
  const match = TRANSACTION_LINE.exec(line);
  if (!match) return false;
  const action = match[1]!;
  const ref = refOf(state, match[2]!);
  if (INSTALL_ACTIONS.has(action)) {
    finishInstalling(state);
    setRunning(state, ref, "installing");
  } else if (action === "Running scriptlet") setRunning(state, ref, "configuring");
  else markDone(state, ref); // Verifying
  return true;
}

function readFailure(state: DnfState, line: string): boolean {
  const unmatched = NO_MATCH.exec(line)?.[1] ?? NO_MATCH_ARGUMENT.exec(line)?.[1];
  const names = unmatched ? unmatched.split(/\s+/) : [SCRIPTLET_ERROR.exec(line)?.[1]].filter((name): name is string => Boolean(name));
  if (FAILED_HEADER.test(line)) state.section = "failed";
  for (const name of names) markFailed(state, nameOf(name));
  return names.length > 0 || FAILED_HEADER.test(line);
}

function readFailedList(state: DnfState, line: string): boolean {
  if (state.section !== "failed") return false;
  const text = line.trim();
  if (!text) state.section = "none";
  else for (const word of text.split(/\s+/)) markFailed(state, nameOf(word));
  return true;
}

const READERS = [readSummary, readSectionHeader, readTableRow, readDownload, readTransactionStart, readTransactionLine, readFailure, readFailedList];

/** What the page shows, as one comparable value. */
const visibleState = (state: DnfState) => JSON.stringify([state.packages.done.length, state.packages.running, state.packages.failed, state.current]);

/** Applies one output line. Returns true when the visible state changed. */
export function applyDnfLine(state: DnfState, line: string): boolean {
  const text = line.trimEnd();
  const before = visibleState(state);
  READERS.some((reader) => reader(state, text));
  syncTotal(state);
  return before !== visibleState(state);
}

/** A package that dnf did not say anything about (a run that died) but is known to have failed. */
export function recordFailure(state: DnfState, name: string): void {
  markFailed(state, name);
  syncTotal(state);
}

/** A dnf run ended. A good run commits its total; a failed one drops it (the per-package retry reports its own). */
export function endDnfRun(state: DnfState, ok: boolean): void {
  if (ok) {
    for (const pkg of [...state.packages.running]) markDone(state, pkg);
    state.committed += state.current;
  } else {
    for (const pkg of [...state.packages.running]) markFailed(state, pkg.name);
  }
  state.current = 0;
  state.known = {};
  state.section = "none";
  state.wrapped = undefined;
  syncTotal(state);
}
