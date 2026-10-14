import type { PhaseId } from "../model.ts";
import type { Phase } from "../runner.ts";
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
import type { PhaseContext } from "./context.ts";

/** The install, in order. The ids are the ones of `PHASE_IDS`; a test keeps them in step. */
export const PHASES: Phase<PhaseContext, PhaseId>[] = [reposPhase, preparePhase, phpPhase, packagesPhase, postPhase, databasePhase, panelPhase, timezonePhase, passwordsPhase, rebootPhase];
