import type { PhaseId } from "../state.ts";
import type { Phase } from "../runner.ts";
import { REMI_PHP_STREAM } from "../packages.ts";
import { parseOsRelease, versionMajor } from "../text-edits.ts";
import { attempt, installOrFail, SHORT_TIMEOUT_MS, type PhaseContext } from "./context.ts";

const remiReleaseUrl = (major: number) => `https://rpms.remirepo.net/enterprise/remi-release-${major}.rpm`;
const EXTRA_REPOS = ["remi", "powertools", "devel"];

async function systemMajor(context: PhaseContext): Promise<number> {
  return versionMajor(parseOsRelease(await context.fs.read("/etc/os-release").catch(() => "")));
}

/** Without the Remi repo and its PHP stream, php-imap, php-mcrypt and php-tidy do not exist. A rerun finds it installed and moves on. */
async function installRemi(context: PhaseContext): Promise<void> {
  if (await context.shell.ok("rpm", ["-q", "remi-release"])) return;
  await installOrFail(context, [remiReleaseUrl(await systemMajor(context))]);
}

async function enablePhpStream(context: PhaseContext): Promise<void> {
  await attempt(context, "dnf module reset php", () => context.shell.ok("dnf", ["module", "reset", "php", "-y"], { timeoutMs: SHORT_TIMEOUT_MS }));
  await context.shell.must("dnf", ["module", "enable", REMI_PHP_STREAM, "-y"], { timeoutMs: SHORT_TIMEOUT_MS });
}

async function enableExtraRepos(context: PhaseContext): Promise<void> {
  for (const repo of EXTRA_REPOS) await attempt(context, `repositório ${repo}`, () => context.shell.ok("dnf", ["config-manager", "--set-enabled", repo]));
}

export const phpPhase: Phase<PhaseContext, PhaseId> = {
  id: "php",
  label: "PHP 7.4 (Remi)",
  async run(context) {
    await installRemi(context);
    await enablePhpStream(context);
    await enableExtraRepos(context);
  },
};
