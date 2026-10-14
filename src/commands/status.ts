// `netinstall status` and `netinstall check`: both only read.
import type { CommandCtx, CommandDef, PackageProgress, Sdk } from "@pvx/sdk";
import { statusLines } from "../health/summary.ts";
import { runChecks } from "../preflight.ts";
import { JOB_NAME, REBOOT_PHASE, STORE_KEY, type InstallState } from "../state.ts";
import { printCheck } from "./context.ts";

function printProgress(ctx: CommandCtx, sdk: Sdk): void {
  const state = ctx.phases.state(JOB_NAME);
  if (!state) {
    ctx.out.info("nenhuma instalação registrada");
    return;
  }
  const packages = ctx.store.get<PackageProgress>(STORE_KEY.packages);
  const install = ctx.store.get<InstallState>(STORE_KEY.install);
  const facts = { progress: sdk.phases.progress(state), installed: sdk.phases.finished(state, [REBOOT_PHASE]) };
  statusLines(state, packages, install, facts).forEach((line) => ctx.out.plain(line));
}

export const statusCommands = (sdk: Sdk): Record<string, CommandDef> => ({
  "netinstall status": {
    help: "Mostra as fases, os pacotes e o erro da última instalação",
    readonly: true,
    async run(ctx) {
      ctx.out.info(`job: ${(await ctx.jobs.status(JOB_NAME)).state}`);
      printProgress(ctx, sdk);
    },
  },
  "netinstall check": {
    help: "Verifica root, sistema, rede, memória e instalação anterior (só leitura)",
    args: [{ name: "force", help: "Ignora uma instalação anterior", kind: "flag" }],
    readonly: true,
    async run(ctx) {
      const checks = await runChecks({ exec: ctx.exec, fs: ctx.fs, isRoot: ctx.isRoot, force: ctx.flag("force") });
      checks.forEach((result) => printCheck(ctx, result));
    },
  },
});
