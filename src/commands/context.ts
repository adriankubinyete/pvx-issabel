// Helpers the netinstall commands share: how they talk, how they start the job and follow its log.
import type { CommandCtx } from "@pvx/sdk";
import { FOLLOW_POLL_MS, sleep } from "../clock.ts";
import { messageOf } from "../errors.ts";
import { checkLine } from "../health/summary.ts";
import type { Check } from "../preflight.ts";
import { JOB_NAME } from "../state.ts";
import { HOW_TO_FOLLOW, STOPPED, STOPPED_FAILED } from "../texts.ts";

export const FOLLOW_ARG = { name: "follow", help: "Acompanha o log até o fim (padrão: só diz como acompanhar)", kind: "flag" } as const;

export function printCheck(ctx: CommandCtx, check: Check): void {
  const line = checkLine(check);
  ctx.out[line.kind](line.text);
}

export const isRunning = async (ctx: CommandCtx) => (await ctx.jobs.status(JOB_NAME)).state === "running";

/** Streams the job log until the job ends, then says how it ended. */
async function followJob(ctx: CommandCtx): Promise<void> {
  let seen = 0;
  for (;;) {
    const lines = await ctx.jobs.log(JOB_NAME, { since: seen });
    lines.forEach((line) => ctx.out.plain(line));
    seen += lines.length;
    const { state } = await ctx.jobs.status(JOB_NAME);
    if (state !== "running" && !lines.length) return reportEnd(ctx, state);
    await sleep(FOLLOW_POLL_MS);
  }
}

function reportEnd(ctx: CommandCtx, state: string): void {
  if (state === "done") ctx.out.success("instalação concluída");
  else if (state === "stopped") ctx.out.warning(STOPPED);
  else ctx.out.error(STOPPED_FAILED);
}

export async function startJob(ctx: CommandCtx, line: string, secrets?: Record<string, string>): Promise<boolean> {
  try {
    await ctx.jobs.start(JOB_NAME, line, { secrets });
  } catch (error) {
    ctx.out.error(messageOf(error));
    return false;
  }
  ctx.out.success("instalação iniciada em segundo plano");
  return true;
}

export async function followOrExplain(ctx: CommandCtx): Promise<void> {
  if (ctx.flag("follow")) await followJob(ctx);
  else ctx.out.info(HOW_TO_FOLLOW);
}

