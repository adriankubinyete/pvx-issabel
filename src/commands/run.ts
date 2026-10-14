// `netinstall run`: the body of the job. Internal: `netinstall` and `netinstall resume` start it.
import type { CommandCtx, CommandDef, Sdk } from "@pvx/sdk";
import { sleep } from "../clock.ts";
import { messageOf } from "../errors.ts";
import { executeInstall, type InstallRequest } from "../install.ts";
import { OPTION_ARGS, readOptions } from "../options.ts";
import { installPaths } from "../paths.ts";
import { MISSING_PASSWORDS } from "../texts.ts";

function requestOf(ctx: CommandCtx): InstallRequest | string {
  if (ctx.flag("resume")) return { mode: "resume" };
  const parsed = readOptions(ctx);
  if (!parsed.ok) return parsed.error;
  const sql = ctx.option("sql-password");
  const web = ctx.option("web-password");
  if (!sql || !web) return MISSING_PASSWORDS;
  return { mode: "fresh", options: parsed.options, passwords: { sql, web } };
}

export function runCommands(sdk: Sdk): Record<string, CommandDef> {
  async function runInstall(ctx: CommandCtx): Promise<void> {
    const request = requestOf(ctx);
    if (typeof request === "string") {
      ctx.out.error(request);
      return;
    }
    // A signal on every exec puts each program in its own process group: that is what lets `jobs.stop` kill them with the job.
    const { signal } = new AbortController();
    const outcome = await executeInstall(ctx, { paths: installPaths(), signal, packages: sdk.packages, now: Date.now, sleep }, request);
    if (!outcome.ok && !outcome.failedPhase) ctx.out.error(messageOf(outcome.error));
  }

  return {
    "netinstall run": {
      help: "Interno: o corpo do job de instalação (use `netinstall` ou `netinstall resume`)",
      args: [...OPTION_ARGS, { name: "resume", help: "Continua da fase que parou, pulando as concluídas", kind: "flag" }],
      run: runInstall,
    },
  };
}
