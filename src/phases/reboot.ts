// The last phase: the central restarts by itself after a countdown the page shows. `netinstall reboot` (now) and
// `netinstall postpone` answer it from another process through the `reboot` store key.
import type { PhasesState } from "@pvx/sdk";
import { REBOOT_PHASE, STORE_KEY, type RebootPlan } from "../state.ts";
import type { InstallPhase, PhaseContext } from "./context.ts";

export const REBOOT_DELAY_MS = 60_000;
export const REBOOTING_DETAIL = "reiniciando";
const POLL_MS = 1000;

const readPlan = (context: PhaseContext) => context.store.get<RebootPlan>(STORE_KEY.reboot);

/** Waits for the deadline or for an answer. Returns what was chosen. */
async function waitForReboot(context: PhaseContext): Promise<RebootPlan["choice"]> {
  for (;;) {
    const plan = readPlan(context);
    if (plan && plan.choice !== "wait") return plan.choice;
    if (plan && context.now() >= plan.at) return "now";
    await context.sleep(POLL_MS);
  }
}

export const rebootPhase: InstallPhase = {
  id: REBOOT_PHASE,
  label: "reiniciar",
  weight: 5,
  async run(context) {
    if (!context.options.reboot) return { skipped: "--no-reboot" };
    context.store.set(STORE_KEY.reboot, { at: context.now() + REBOOT_DELAY_MS, choice: "wait" } satisfies RebootPlan);
    if ((await waitForReboot(context)) === "postponed") {
      context.say.warning("reinício adiado: reinicie a central quando puder");
      return { detail: "adiado" };
    }
    // The phase is recorded first: the reboot ends this process before anything could.
    context.say.info("reiniciando a central");
    return { detail: REBOOTING_DETAIL };
  },
};

/** True when the reboot phase ended wanting the restart (not postponed, not skipped). */
export const rebootRequested = (state: PhasesState | undefined): boolean => state?.phases.find((phase) => phase.id === REBOOT_PHASE)?.detail === REBOOTING_DETAIL;

/** Runs after the runner has recorded the last phase as done. */
export const rebootNow = (context: PhaseContext) => context.shell.run("reboot", []);
