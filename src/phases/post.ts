import type { PhaseId } from "../state.ts";
import type { Phase } from "../runner.ts";
import { attempt, type PhaseContext } from "./context.ts";
import { clearRootPassword, setTemporaryRootPassword } from "./mysql.ts";

const ISSABEL_CONF = "/etc/issabel.conf";
const CDR_DIR = "/var/log/asterisk/cdr-csv";
const AMPORTAL = "/usr/sbin/amportal";

async function startDatabase(context: PhaseContext): Promise<void> {
  await attempt(context, "systemctl enable mariadb", () => context.shell.ok("systemctl", ["enable", "mariadb.service"]));
  await context.shell.must("systemctl", ["start", "mariadb"]);
}

/** firewalld is optional: many VPS images do not ship it. Disabled only when it is there. */
async function disableFirewalld(context: PhaseContext): Promise<void> {
  if (!(await context.shell.ok("firewall-cmd", ["--version"]))) return;
  await attempt(context, "systemctl disable firewalld", () => context.shell.ok("systemctl", ["disable", "firewalld"]));
  await attempt(context, "systemctl stop firewalld", () => context.shell.ok("systemctl", ["stop", "firewalld"]));
}

/** fop2 ships with Issabel but overloads some centrals: off now, and never on after a reboot. */
async function turnFop2Off(context: PhaseContext): Promise<void> {
  await attempt(context, "systemctl stop fop2", () => context.shell.ok("systemctl", ["stop", "fop2"]));
  await attempt(context, "systemctl disable fop2", () => context.shell.ok("systemctl", ["disable", "fop2"]));
}

export const postPhase: Phase<PhaseContext, PhaseId> = {
  id: "post",
  label: "pós-instalação",
  async run(context) {
    await startDatabase(context);
    await setTemporaryRootPassword(context);
    await attempt(context, "systemctl enable httpd", () => context.shell.ok("systemctl", ["enable", "httpd"]));
    await disableFirewalld(context);
    await context.shell.must("rm", ["-f", ISSABEL_CONF]);
    await clearRootPassword(context);
    await context.shell.must("mkdir", ["--parents", CDR_DIR]);
    await attempt(context, "amportal chown", () => context.shell.ok(AMPORTAL, ["chown"]));
    await turnFop2Off(context);
  },
};
