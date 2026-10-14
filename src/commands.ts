// The `netinstall` commands. Each is a short list of named steps; the install itself is in install.ts.
import type { CommandCtx, CommandDef } from "@pvx/sdk";
import { FOLLOW_POLL_MS, sleep } from "./clock.ts";
import { messageOf } from "./errors.ts";
import { executeInstall, type InstallRequest } from "./install.ts";
import { JOB_NAME, PROGRESS_KEY, REBOOT_KEY, type NetinstallProgress, type RebootPlan } from "./model.ts";
import { OPTION_ARGS, jobLine, passwordOrGenerated, readOptions } from "./options.ts";
import { blockingProblems, runChecks, warnings, type Check, type PreflightDeps } from "./preflight.ts";
import { checkLine, statusLines } from "./report.ts";
import type { Say } from "./runtime.ts";
import { systemOf, type SystemOverrides } from "./system.ts";

const FOLLOW_ARG = { name: "follow", help: "Acompanha o log até o fim (padrão: só diz como acompanhar)", kind: "flag" } as const;
const HOW_TO_FOLLOW = "acompanhe com: pvx jobs log issabel netinstall -f";
const RESUME_LINE = "netinstall run --resume";

const sayOf = (ctx: CommandCtx): Say => ({ info: ctx.out.info, success: ctx.out.success, warning: ctx.out.warning, error: ctx.out.error, raw: ctx.jobLog });

function printCheck(ctx: CommandCtx, check: Check): void {
  const line = checkLine(check);
  ctx.out[line.kind](line.text);
}

const isRunning = async (ctx: CommandCtx) => (await ctx.jobs.status(JOB_NAME)).state === "running";

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
  else if (state === "stopped") ctx.out.warning("instalação parada: continue com `pvx issabel netinstall resume`");
  else ctx.out.error("a instalação parou: veja `pvx issabel netinstall status` e continue com `pvx issabel netinstall resume`");
}

async function startJob(ctx: CommandCtx, line: string, secrets?: Record<string, string>): Promise<boolean> {
  try {
    await ctx.jobs.start(JOB_NAME, line, { secrets });
  } catch (error) {
    ctx.out.error(messageOf(error));
    return false;
  }
  ctx.out.success("instalação iniciada em segundo plano");
  return true;
}

async function followOrExplain(ctx: CommandCtx): Promise<void> {
  if (ctx.flag("follow")) await followJob(ctx);
  else ctx.out.info(HOW_TO_FOLLOW);
}

function statusOf(ctx: CommandCtx): void {
  const progress = ctx.store.get<NetinstallProgress>(PROGRESS_KEY);
  if (!progress) {
    ctx.out.info("nenhuma instalação registrada");
    return;
  }
  statusLines(progress).forEach((line) => ctx.out.plain(line));
}

/** Answers the countdown of the last phase. */
function answerReboot(choice: RebootPlan["choice"], done: string): CommandDef["run"] {
  return (ctx) => {
    const plan = ctx.store.get<RebootPlan>(REBOOT_KEY);
    if (!plan || plan.choice !== "wait") {
      ctx.out.error("não há reinício agendado");
      return;
    }
    ctx.store.set(REBOOT_KEY, { ...plan, choice });
    ctx.out.success(done);
  };
}

export function createCommands(overrides: SystemOverrides = {}): Record<string, CommandDef> {
  const preflightOf = (ctx: CommandCtx, force: boolean): PreflightDeps => {
    const { exec, fs, isRoot } = systemOf(ctx, overrides);
    return { exec, fs, isRoot, force };
  };

  async function startInstall(ctx: CommandCtx): Promise<void> {
    const parsed = readOptions(ctx);
    if (!parsed.ok) {
      ctx.out.error(parsed.error);
      return;
    }
    if (await isRunning(ctx)) {
      ctx.out.error(`a instalação já está rodando: ${HOW_TO_FOLLOW}`);
      return;
    }
    const checks = await runChecks(preflightOf(ctx, parsed.options.force), (check) => printCheck(ctx, check));
    if (blockingProblems(checks).length) return;
    warnings(checks).forEach((warning) => ctx.out.warning(warning));
    const secrets = { "sql-password": passwordOrGenerated(ctx.option("sql-password")), "web-password": passwordOrGenerated(ctx.option("web-password")) };
    if (await startJob(ctx, jobLine(parsed.options), secrets)) await followOrExplain(ctx);
  }

  function requestOf(ctx: CommandCtx): InstallRequest | string {
    if (ctx.flag("resume")) return { mode: "resume" };
    const parsed = readOptions(ctx);
    if (!parsed.ok) return parsed.error;
    const sql = ctx.option("sql-password");
    const web = ctx.option("web-password");
    if (!sql || !web) return "faltam as senhas: o job as recebe pelo pvx (PVX_SECRET_SQL_PASSWORD e PVX_SECRET_WEB_PASSWORD)";
    return { mode: "fresh", options: parsed.options, passwords: { sql, web } };
  }

  async function runInstall(ctx: CommandCtx): Promise<void> {
    const request = requestOf(ctx);
    if (typeof request === "string") {
      ctx.out.error(request);
      return;
    }
    const { exec, fs, paths, sleep: wait } = systemOf(ctx, overrides);
    // A signal on every exec puts each program in its own process group: that is what lets `jobs.stop` kill them with the job.
    const { signal } = new AbortController();
    const outcome = await executeInstall({ exec, fs, store: ctx.store, say: sayOf(ctx), paths, signal, now: Date.now, sleep: wait }, request);
    if (!outcome.ok && !outcome.failedPhase) ctx.out.error(outcome.error.message);
  }

  async function resumeInstall(ctx: CommandCtx): Promise<void> {
    if (!ctx.store.get<NetinstallProgress>(PROGRESS_KEY)) {
      ctx.out.error("não há instalação para continuar: rode `pvx issabel netinstall`");
      return;
    }
    if (await startJob(ctx, RESUME_LINE)) await followOrExplain(ctx);
  }

  return {
    netinstall: { help: "Instala o Issabel 5 do zero (Rocky/RHEL 8+), em segundo plano", args: [...OPTION_ARGS, FOLLOW_ARG], destructive: true, run: startInstall },
    "netinstall run": {
      help: "Interno: o corpo do job de instalação (use `netinstall` ou `netinstall resume`)",
      args: [...OPTION_ARGS, { name: "resume", help: "Continua da fase que parou, pulando as concluídas", kind: "flag" }],
      run: runInstall,
    },
    "netinstall status": {
      help: "Mostra as fases, os pacotes e o erro da última instalação",
      readonly: true,
      async run(ctx) {
        ctx.out.info(`job: ${(await ctx.jobs.status(JOB_NAME)).state}`);
        statusOf(ctx);
      },
    },
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
        ctx.out.warning("instalação parada: continue com `pvx issabel netinstall resume`");
      },
    },
    "netinstall resume": { help: "Continua a instalação da fase que parou, pulando as concluídas", args: [FOLLOW_ARG], run: resumeInstall },
    "netinstall check": {
      help: "Verifica root, sistema, rede, memória e instalação anterior (só leitura)",
      args: [{ name: "force", help: "Ignora uma instalação anterior", kind: "flag" }],
      readonly: true,
      async run(ctx) {
        const checks = await runChecks(preflightOf(ctx, ctx.flag("force")));
        checks.forEach((result) => printCheck(ctx, result));
      },
    },
    "netinstall reboot": { help: "Reinicia a central agora, sem esperar a contagem", destructive: true, run: answerReboot("now", "reiniciando em instantes") },
    "netinstall postpone": { help: "Adia o reinício automático; reinicie depois, à mão", run: answerReboot("postponed", "reinício adiado") },
  };
}
