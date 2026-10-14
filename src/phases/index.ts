import type { PhaseDef } from "@pvx/sdk";
import { databasePhase } from "./database.ts";
import { packagesPhase } from "./packages.ts";
import { panelPhase } from "./panel.ts";
import { passwordsPhase } from "./passwords.ts";
import { phpPhase } from "./php.ts";
import { postPhase } from "./post.ts";
import { preparePhase } from "./prepare.ts";
import { rebootPhase } from "./reboot.ts";
import { reposPhase } from "./repos.ts";
import { timezonePhase } from "./timezone.ts";
import type { InstallPhase, PhaseContext } from "./context.ts";

/** The install, in order. */
export const PHASES: InstallPhase[] = [reposPhase, preparePhase, phpPhase, packagesPhase, postPhase, databasePhase, panelPhase, timezonePhase, passwordsPhase, rebootPhase];

/** The phases as `ctx.phases.run` takes them, each one running over `context`. */
export const phaseDefsOf = (context: PhaseContext): PhaseDef[] =>
  PHASES.map((phase) => ({ id: phase.id, label: phase.label, weight: phase.weight, run: () => phase.run(context) }));
