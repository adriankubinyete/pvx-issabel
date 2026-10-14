import { join } from "node:path";
import { IPV6_GUARD_LINE, withIpv6Guard } from "../text-edits.ts";
import { attempt, installOrFail, SHORT_TIMEOUT_MS, type PhaseContext, type InstallPhase } from "./context.ts";

const SYSCTL_FILE = "/etc/sysctl.conf";
const YUM_REPOS_DIR = "/etc/yum.repos.d/";
const REPO_FILES = ["Issabel.repo", "Issabel5.repo", "commercial-addons.repo", "irontec.repo"];

const refreshMetadata = (context: PhaseContext) =>
  attempt(context, "dnf makecache", async () => (await context.shell.ok("dnf", ["makecache"], { timeoutMs: SHORT_TIMEOUT_MS })));

/** The ipv6 guard goes in only once, so a rerun leaves the file alone. */
async function guardIpv6(context: PhaseContext): Promise<void> {
  const before = await context.fs.read(SYSCTL_FILE).catch(() => "");
  const after = withIpv6Guard(before);
  if (after !== before) await context.fs.write(SYSCTL_FILE, after);
  context.say.info(after === before ? `${IPV6_GUARD_LINE}: já presente` : `${IPV6_GUARD_LINE}: acrescentado`);
  await attempt(context, "sysctl -p", () => context.shell.ok("sysctl", ["-p"]));
}

const copyRepoFiles = (context: PhaseContext) =>
  context.shell.must("cp", ["-f", ...REPO_FILES.map((file) => join(context.paths.assets, "repos", file)), YUM_REPOS_DIR]);

export const reposPhase: InstallPhase = {
  id: "repos",
  label: "repositórios",
  weight: 4,
  async run(context) {
    await installOrFail(context, ["epel-release"]);
    await refreshMetadata(context);
    await installOrFail(context, ["htop", "tmux"]);
    await guardIpv6(context);
    await copyRepoFiles(context);
  },
};
