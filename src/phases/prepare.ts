import type { PhaseId } from "../model.ts";
import type { Phase } from "../runner.ts";
import { passwdHasUser, withSelinuxDisabled } from "../text-edits.ts";
import { attempt, installOrFail, type PhaseContext } from "./context.ts";

const SELINUX_CONFIG = "/etc/selinux/config";
const PASSWD_FILE = "/etc/passwd";
const ASTERISK_HOME = "/var/lib/asterisk";

/** SELinux off now (`setenforce`, harmless when already off) and after the reboot (the config file). */
async function disableSelinux(context: PhaseContext): Promise<void> {
  await attempt(context, "setenforce 0", () => context.shell.ok("setenforce", ["0"]));
  const before = await context.fs.read(SELINUX_CONFIG).catch(() => undefined);
  if (before === undefined) return;
  const after = withSelinuxDisabled(before);
  if (after !== before) await context.fs.write(SELINUX_CONFIG, after);
}

/** The group is created with `-f` (no error when it exists) and the user only when /etc/passwd lacks it. */
async function ensureAsteriskUser(context: PhaseContext): Promise<void> {
  await context.shell.must("groupadd", ["-f", "-r", "asterisk"]);
  const passwd = await context.fs.read(PASSWD_FILE).catch(() => "");
  if (passwdHasUser(passwd, "asterisk")) return;
  await context.shell.must("useradd", ["-r", "-g", "asterisk", "-c", "Asterisk PBX", "-s", "/bin/bash", "-d", ASTERISK_HOME, "asterisk"]);
}

export const preparePhase: Phase<PhaseContext, PhaseId> = {
  id: "prepare",
  label: "preparo do sistema",
  async run(context) {
    await disableSelinux(context);
    await ensureAsteriskUser(context);
    await installOrFail(context, ["issabel-config_helpers"]);
  },
};
