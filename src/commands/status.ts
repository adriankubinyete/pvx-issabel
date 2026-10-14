// `netinstall status` and `netinstall check`: both only read.
import type { CommandCtx, CommandDef, PackageProgress } from "@pvx/sdk";
import { statusLines } from "../health/summary.ts";
import { realIsRoot, runChecks } from "../preflight.ts";
import { JOB_NAME, STORE_KEY, type InstallState } from "../state.ts";
import { printCheck } from "./context.ts";

function printProgress(ctx: CommandCtx): void {
  const state = ctx.phases.state(JOB_NAME);
  if (!state) {
    ctx.out.info("nenhuma instalação registrada");
    return;
  }
  const packages = ctx.store.get<PackageProgress>(STORE_KEY.packages);
  const install = ctx.store.get<InstallState>(STORE_KEY.install);
  statusLines(state, packages, install).forEach((line) => ctx.out.plain(line));
}

export const statusCommands: Record<string, CommandDef> = {
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
      const checks = await runChecks({ exec: ctx.exec, fs: ctx.fs, isRoot: realIsRoot, force: ctx.flag("force") });
      checks.forEach((result) => printCheck(ctx, result));
    },
  },
};
