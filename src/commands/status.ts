// `netinstall status` and `netinstall check`: both only read.
import type { CommandCtx, CommandDef } from "@pvx/sdk";
import { statusLines } from "../health/summary.ts";
import { runChecks } from "../preflight.ts";
import { JOB_NAME, STORE_KEY, type NetinstallProgress } from "../state.ts";
import { systemOf, type SystemOverrides } from "../system.ts";
import { printCheck } from "./context.ts";

function printProgress(ctx: CommandCtx): void {
  const progress = ctx.store.get<NetinstallProgress>(STORE_KEY.progress);
  if (!progress) {
    ctx.out.info("nenhuma instalação registrada");
    return;
  }
  statusLines(progress).forEach((line) => ctx.out.plain(line));
}

export function statusCommands(overrides: SystemOverrides): Record<string, CommandDef> {
  return {
    "netinstall status": {
      help: "Mostra as fases, os pacotes e o erro da última instalação",
      readonly: true,
      async run(ctx) {
        ctx.out.info(`job: ${(await ctx.jobs.status(JOB_NAME)).state}`);
        printProgress(ctx);
      },
    },
    "netinstall check": {
      help: "Verifica root, sistema, rede, memória e instalação anterior (só leitura)",
      args: [{ name: "force", help: "Ignora uma instalação anterior", kind: "flag" }],
      readonly: true,
      async run(ctx) {
        const { exec, fs, isRoot } = systemOf(ctx, overrides);
        const checks = await runChecks({ exec, fs, isRoot, force: ctx.flag("force") });
        checks.forEach((result) => printCheck(ctx, result));
      },
    },
  };
}
