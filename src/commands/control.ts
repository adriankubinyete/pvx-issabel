// `netinstall stop`, `reboot` and `postpone`: what the technician does to an install that is running.
import type { CommandDef } from "@pvx/sdk";
import { messageOf } from "../errors.ts";
import { JOB_NAME, STORE_KEY, type RebootPlan } from "../state.ts";
import { NO_REBOOT_PLAN, STOPPED } from "../texts.ts";

/** Answers the countdown of the last phase. */
function answerReboot(choice: RebootPlan["choice"], done: string): CommandDef["run"] {
  return (ctx) => {
    const plan = ctx.store.get<RebootPlan>(STORE_KEY.reboot);
    if (!plan || plan.choice !== "wait") {
      ctx.out.error(NO_REBOOT_PLAN);
      return;
    }
    ctx.store.set(STORE_KEY.reboot, { ...plan, choice });
    ctx.out.success(done);
  };
}

export const controlCommands: Record<string, CommandDef> = {
  "netinstall stop": {
    help: "Para a instalação em segundo plano",
    destructive: true,
    async run(ctx) {
      try {
        await ctx.jobs.stop(JOB_NAME);
      } catch (error) {
        ctx.out.error(messageOf(error));
        return;
      }
      ctx.out.warning(STOPPED);
    },
  },
  "netinstall reboot": { help: "Reinicia a central agora, sem esperar a contagem", destructive: true, run: answerReboot("now", "reiniciando em instantes") },
  "netinstall postpone": { help: "Adia o reinício automático; reinicie depois, à mão", run: answerReboot("postponed", "reinício adiado") },
};
