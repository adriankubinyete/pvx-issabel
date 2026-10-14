// `netinstall` (verify, then start the job) and `netinstall resume`.
import type { CommandCtx, CommandDef } from "@pvx/sdk";
import { JOB_NAME } from "../state.ts";
import { OPTION_ARGS, jobLine, passwordOrGenerated, readOptions } from "../options.ts";
import { blockingProblems, realIsRoot, runChecks, warnings } from "../preflight.ts";
import { ALREADY_RUNNING, FIX, NO_RUN_TO_RESUME } from "../texts.ts";
import { FOLLOW_ARG, followOrExplain, isRunning, printCheck, startJob } from "./context.ts";

const RESUME_LINE = `${JOB_NAME} run --resume`;

async function startInstall(ctx: CommandCtx): Promise<void> {
  const parsed = readOptions(ctx);
  if (!parsed.ok) {
    ctx.out.error(parsed.error);
    return;
  }
  if (await isRunning(ctx)) {
    ctx.out.error(ALREADY_RUNNING);
    return;
  }
  const checks = await runChecks({ exec: ctx.exec, fs: ctx.fs, isRoot: realIsRoot, force: parsed.options.force }, (check) => printCheck(ctx, check));
  if (blockingProblems(checks).length) return;
  warnings(checks).forEach((warning) => ctx.out.warning(warning));
  const secrets = { "sql-password": passwordOrGenerated(ctx.option("sql-password")), "web-password": passwordOrGenerated(ctx.option("web-password")) };
  if (await startJob(ctx, jobLine(parsed.options), secrets)) await followOrExplain(ctx);
}

async function resumeInstall(ctx: CommandCtx): Promise<void> {
  if (!ctx.phases.state(JOB_NAME)) {
    ctx.out.error(NO_RUN_TO_RESUME);
    return;
  }
  if (await startJob(ctx, RESUME_LINE)) await followOrExplain(ctx);
}

export const startCommands: Record<string, CommandDef> = {
  netinstall: { help: `Instala o Issabel 5 do zero (Rocky/RHEL 8+), em segundo plano (${FIX.netinstall})`, args: [...OPTION_ARGS, FOLLOW_ARG], destructive: true, run: startInstall },
  "netinstall resume": { help: "Continua a instalação da fase que parou, pulando as concluídas", args: [FOLLOW_ARG], run: resumeInstall },
};
