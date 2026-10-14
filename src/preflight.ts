// The checks that run before an install. Each one is its own function; `runChecks` runs them in order, `checkOne` runs one by id
// (the page asks for them one at a time so each gets its spinner).
import type { ExecFn, FsRead } from "./exec.ts";
import { MIN_MEM_KB, MIRROR_PROBE_URL } from "./packages.ts";
import { isRhelLike, memTotalKb, parseOsRelease, systemName, versionMajor } from "./text-edits.ts";

export const CHECK_IDS = ["root", "system", "network", "memory", "previous"] as const;
export type CheckId = (typeof CHECK_IDS)[number];
export const CHECK_LABEL: Record<CheckId, string> = {
  root: "root",
  system: "sistema",
  network: "rede",
  memory: "memória",
  previous: "instalação anterior",
};

export interface Check {
  id: CheckId;
  level: "ok" | "warn" | "error";
  /** Short, for the line of the screen ("Rocky Linux 8.10", "120 ms"). */
  detail?: string;
  /** What to tell the technician when the level is not ok. */
  message?: string;
}

export interface PreflightDeps {
  exec: ExecFn;
  fs: FsRead;
  isRoot: boolean;
  force: boolean;
}

export const MIN_OS_MAJOR = 8;
const NETWORK_TIMEOUT_S = 15;
const NETWORK_RETRIES = 2;
const NETWORK_RETRY_DELAY_S = 2;
/** Every attempt may use the whole timeout, plus the pauses between them. */
const NETWORK_BUDGET_MS = (NETWORK_RETRIES + 1) * (NETWORK_TIMEOUT_S + NETWORK_RETRY_DELAY_S) * 1000;
const OS_RELEASE_FILE = "/etc/os-release";
const MEMINFO_FILE = "/proc/meminfo";
const ISSABEL_CONF = "/etc/issabel.conf";

const ok = (id: CheckId, detail?: string): Check => ({ id, level: "ok", detail });

function checkRoot({ isRoot }: PreflightDeps): Check {
  if (isRoot) return ok("root");
  return { id: "root", level: "error", message: "o netinstall precisa rodar como root (sudo)." };
}

async function readRelease(fs: FsRead) {
  return parseOsRelease(await fs.read(OS_RELEASE_FILE).catch(() => ""));
}

async function checkSystem({ fs }: PreflightDeps): Promise<Check> {
  const release = await readRelease(fs);
  if (!isRhelLike(release)) return { id: "system", level: "error", message: "o sistema não é RHEL-like (Rocky, CentOS, RHEL): não suportado." };
  if (versionMajor(release) < MIN_OS_MAJOR) return { id: "system", level: "error", detail: systemName(release), message: `versão do sistema abaixo do mínimo (${MIN_OS_MAJOR}+).` };
  return ok("system", systemName(release));
}

async function checkNetwork({ exec }: PreflightDeps): Promise<Check> {
  const started = Date.now();
  const args = ["-fsS", "--connect-timeout", "10", "--max-time", String(NETWORK_TIMEOUT_S), "--retry", String(NETWORK_RETRIES), "--retry-delay", String(NETWORK_RETRY_DELAY_S), "--retry-connrefused", "-o", "/dev/null", MIRROR_PROBE_URL];
  const result = await exec("curl", args, { timeoutMs: NETWORK_BUDGET_MS }).catch(() => ({ code: 127 }));
  if (result.code === 0) return ok("network", `${Date.now() - started} ms`);
  return { id: "network", level: "error", message: `sem acesso a ${MIRROR_PROBE_URL}: confira a rede e o DNS da central.` };
}

async function checkMemory({ fs }: PreflightDeps): Promise<Check> {
  const kb = memTotalKb(await fs.read(MEMINFO_FILE).catch(() => ""));
  if (kb === 0) return ok("memory");
  const megabytes = Math.floor(kb / 1024);
  const detail = `RAM+swap ${(kb / 1024 / 1024).toFixed(1)} G`;
  if (kb >= MIN_MEM_KB) return ok("memory", detail);
  return { id: "memory", level: "warn", detail, message: `RAM+swap baixa (${megabytes} MB, recomendado ${MIN_MEM_KB / 1024} MB ou mais).` };
}

/** True when an Asterisk is on the PATH or the Issabel config exists. */
export async function issabelPresent({ exec, fs }: Pick<PreflightDeps, "exec" | "fs">): Promise<boolean> {
  const asterisk = await exec("asterisk", ["-V"], { timeoutMs: 5000 }).catch(() => ({ code: 127 }));
  return asterisk.code === 0 || (await fs.exists(ISSABEL_CONF));
}

async function checkPrevious(deps: PreflightDeps): Promise<Check> {
  if (!(await issabelPresent(deps))) return ok("previous");
  if (deps.force) return { id: "previous", level: "ok", detail: "detectada, ignorada por --force" };
  return { id: "previous", level: "error", detail: "detectada", message: "esta máquina já parece ter Issabel ou Asterisk instalado: use --force para instalar mesmo assim." };
}

const CHECKS: Record<CheckId, (deps: PreflightDeps) => Check | Promise<Check>> = {
  root: checkRoot,
  system: checkSystem,
  network: checkNetwork,
  memory: checkMemory,
  previous: checkPrevious,
};

export const checkOne = async (id: CheckId, deps: PreflightDeps): Promise<Check> => CHECKS[id](deps);

/** All checks in order. Without root nothing else is worth checking, so it stops there (the reference does the same). */
export async function runChecks(deps: PreflightDeps, report: (check: Check) => void = () => {}): Promise<Check[]> {
  const results: Check[] = [];
  for (const id of CHECK_IDS) {
    const check = await checkOne(id, deps);
    results.push(check);
    report(check);
    if (id === "root" && check.level === "error") break;
  }
  return results;
}

export const blockingProblems = (checks: Check[]): string[] => checks.filter((check) => check.level === "error").map((check) => check.message ?? CHECK_LABEL[check.id]);
export const warnings = (checks: Check[]): string[] => checks.filter((check) => check.level === "warn").map((check) => check.message ?? CHECK_LABEL[check.id]);
