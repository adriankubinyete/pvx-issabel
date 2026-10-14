// The read-only queries the page (and anything else) asks: the checks one at a time, the central's state, the progress and the
// credentials of a finished install. They run with the `ReadCtx`: `this` is it.
import type { ModuleQuery, ReadCtx } from "@pvx/sdk";
import { parseCredentials, type Credentials } from "../credentials.ts";
import { JOB_NAME, STORE_KEY, type NetinstallProgress, type RebootPlan } from "../state.ts";
import type { JobSnapshot } from "../progress.ts";
import { readSystemOf, type SystemOverrides } from "../system.ts";
import { CHECK_IDS, checkOne, issabelPresent, type Check, type CheckId } from "../preflight.ts";
import { isRhelLike, parseOsRelease, systemName } from "../text-edits.ts";

export const QUERY_CHECK = "issabel.check";
export const QUERY_CENTRAL = "issabel.central";
export const QUERY_PROGRESS = "issabel.progress";
export const QUERY_CREDENTIALS = "issabel.credentials";

export interface Central {
  hostname: string;
  system: string;
  installed: boolean;
}

/** Everything the live screens read, in one query: the progress, the reboot plan and the job the host knows. */
export interface ProgressView {
  progress?: NetinstallProgress;
  reboot?: RebootPlan;
  job: JobSnapshot;
}

const HOSTNAME_FALLBACK = "—";
const isCheckId = (value: unknown): value is CheckId => CHECK_IDS.some((id) => id === value);


async function hostnameOf(context: Pick<ReadCtx, "exec">): Promise<string> {
  const result = await context.exec("hostname", [], { timeoutMs: 3000 }).catch(() => ({ code: 1, stdout: "" }));
  return result.code === 0 ? result.stdout.trim() || HOSTNAME_FALLBACK : HOSTNAME_FALLBACK;
}


export const progressQuery: ModuleQuery = async function (this: ReadCtx): Promise<ProgressView> {
  const { state, startedAt } = await this.jobs.status(JOB_NAME);
  return { progress: this.store.get<NetinstallProgress>(STORE_KEY.progress), reboot: this.store.get<RebootPlan>(STORE_KEY.reboot), job: { state, startedAt } };
};

export const credentialsQuery: ModuleQuery = async function (this: ReadCtx): Promise<Credentials | undefined> {
  const path = this.store.get<NetinstallProgress>(STORE_KEY.progress)?.credentialsFile;
  return path ? parseCredentials(await this.fs.read(path).catch(() => "")) : undefined;
};

/** The queries of the module. `overrides` is the test seam (see system.ts): in production it is empty. */
export function createQueries(overrides: SystemOverrides = {}): Record<string, ModuleQuery> {
  /** `issabel.check <id> [force]`: one check, so the page can show each with its own spinner. */
  const check: ModuleQuery = async function (this: ReadCtx, _name, id, force) {
    if (!isCheckId(id)) throw new Error(`verificação desconhecida: ${String(id)}`);
    const { exec, fs, isRoot } = readSystemOf(this, overrides);
    return checkOne(id, { exec, fs, isRoot, force: force === true }) satisfies Promise<Check>;
  };

  const central: ModuleQuery = async function (this: ReadCtx): Promise<Central> {
    const { exec, fs } = readSystemOf(this, overrides);
    const release = parseOsRelease(await fs.read("/etc/os-release").catch(() => ""));
    const system = isRhelLike(release) ? systemName(release) : (release.PRETTY_NAME ?? "—");
    return { hostname: await hostnameOf({ exec }), system, installed: await issabelPresent({ exec, fs }) };
  };

  return { [QUERY_CHECK]: check, [QUERY_CENTRAL]: central, [QUERY_PROGRESS]: progressQuery, [QUERY_CREDENTIALS]: credentialsQuery };
}
