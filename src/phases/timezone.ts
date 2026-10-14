import type { PhaseId } from "../state.ts";
import type { Phase } from "../runner.ts";
import { withPhpTimezone } from "../text-edits.ts";
import { attempt, type PhaseContext } from "./context.ts";

const PHP_INI = "/etc/php.ini";

/** `timedatectl` first; where it cannot work (no systemd bus), the symlink does the same. */
async function setSystemTimezone(context: PhaseContext, timezone: string): Promise<void> {
  if (await context.shell.ok("timedatectl", ["set-timezone", timezone])) return;
  await context.shell.must("ln", ["-sf", `/usr/share/zoneinfo/${timezone}`, "/etc/localtime"]);
}

/** PHP keeps its own `date.timezone`, independent of the system clock: without this it stays on UTC. */
async function setPhpTimezone(context: PhaseContext, timezone: string): Promise<void> {
  const before = await context.fs.read(PHP_INI).catch(() => undefined);
  if (before === undefined) return;
  const after = withPhpTimezone(before, timezone);
  if (after !== before) await context.fs.write(PHP_INI, after);
}

export const timezonePhase: Phase<PhaseContext, PhaseId> = {
  id: "timezone",
  label: "fuso horário",
  async run(context) {
    const { timezone } = context.options;
    await setSystemTimezone(context, timezone);
    await attempt(context, "hwclock", () => context.shell.ok("hwclock", ["--hctosys"]));
    await setPhpTimezone(context, timezone);
    // Without a reload, httpd keeps the old date.timezone until the reboot (it matters with --no-reboot).
    await attempt(context, "systemctl reload httpd", () => context.shell.ok("systemctl", ["reload", "httpd"]));
  },
};
