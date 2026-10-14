// The read-only queries the page (and anything else) asks: the checks one at a time, the central's state, the progress and the
// credentials of a finished install. They run with the `ReadCtx`: `this` is it.
import type { ModuleQuery, PackageProgress, ReadCtx } from "@pvx/sdk";
import { parseCredentials, type Credentials } from "../credentials.ts";
import { STORE_KEY, type InstallState, type RebootPlan } from "../state.ts";
import { CHECK_IDS, checkOne, issabelPresent, realIsRoot, type Check, type CheckId } from "../preflight.ts";
import { isRhelLike, parseOsRelease, systemName } from "../text-edits.ts";

export const QUERY_CHECK = "issabel.check";
export const QUERY_CENTRAL = "issabel.central";
export const QUERY_INSTALL = "issabel.install";
export const QUERY_CREDENTIALS = "issabel.credentials";

export interface Central {
  hostname: string;
  system: string;
  installed: boolean;
}

/** What the live screens read besides the run itself (`useRun` has the phases and the job): the install, the packages and the reboot plan. */
export interface InstallView {
  install?: InstallState;
  packages?: PackageProgress;
  reboot?: RebootPlan;
}

const HOSTNAME_FALLBACK = "—";
const isCheckId = (value: unknown): value is CheckId => CHECK_IDS.some((id) => id === value);

async function hostnameOf(context: Pick<ReadCtx, "exec">): Promise<string> {
  const result = await context.exec("hostname", [], { timeoutMs: 3000 }).catch(() => ({ code: 1, stdout: "" }));
  return result.code === 0 ? result.stdout.trim() || HOSTNAME_FALLBACK : HOSTNAME_FALLBACK;
}

export const installQuery: ModuleQuery = async function (this: ReadCtx): Promise<InstallView> {
  const install = this.store.get<InstallState>(STORE_KEY.install);
  const packages = this.store.get<PackageProgress>(STORE_KEY.packages);
  const reboot = this.store.get<RebootPlan>(STORE_KEY.reboot);
  return { install, packages, reboot };
};

export const credentialsQuery: ModuleQuery = async function (this: ReadCtx): Promise<Credentials | undefined> {
  const path = this.store.get<InstallState>(STORE_KEY.install)?.credentialsFile;
  return path ? parseCredentials(await this.fs.read(path).catch(() => "")) : undefined;
};

/** `issabel.check <id> [force]`: one check, so the page can show each with its own spinner. */
const checkQuery: ModuleQuery = async function (this: ReadCtx, _name, id, force) {
  if (!isCheckId(id)) throw new Error(`verificação desconhecida: ${String(id)}`);
  return checkOne(id, { exec: this.exec, fs: this.fs, isRoot: realIsRoot, force: force === true }) satisfies Promise<Check>;
};

const centralQuery: ModuleQuery = async function (this: ReadCtx): Promise<Central> {
  const release = parseOsRelease(await this.fs.read("/etc/os-release").catch(() => ""));
  const system = isRhelLike(release) ? systemName(release) : (release.PRETTY_NAME ?? "—");
  return { hostname: await hostnameOf(this), system, installed: await issabelPresent(this) };
};

/** The queries of the module. */
export const queries: Record<string, ModuleQuery> = {
  [QUERY_CHECK]: checkQuery,
  [QUERY_CENTRAL]: centralQuery,
  [QUERY_INSTALL]: installQuery,
  [QUERY_CREDENTIALS]: credentialsQuery,
};
