// A list of named phases run in order, with resume: a phase already finished is skipped. Generic: it knows nothing of Issabel
// (see the report: a candidate for the SDK, for any installer that works in phases).
import { messageOf } from "./errors.ts";
import type { Say } from "./exec.ts";

export interface PhaseOutcome {
  /** A short note kept with the phase ("adiado"). */
  detail?: string;
  /** The phase had nothing to do: it is marked skipped, with this as the reason. */
  skipped?: string;
}

export interface Phase<Context, Id extends string = string> {
  id: Id;
  label: string;
  run(context: Context): Promise<PhaseOutcome | void>;
}

/** How the runner reports: the caller keeps the progress, the runner only says what happened. */
export interface PhaseHooks<Id extends string = string> {
  isFinished(id: Id): boolean;
  started(id: Id): void;
  finished(id: Id, detail?: string): void;
  skipped(id: Id, reason: string): void;
  failed(id: Id, error: unknown): void;
}

export type RunResult<Id extends string = string> = { ok: true } | { ok: false; failedPhase: Id; error: unknown };

export async function runPhases<Context, Id extends string>(phases: Phase<Context, Id>[], context: Context, hooks: PhaseHooks<Id>, say: Say): Promise<RunResult<Id>> {
  for (const phase of phases) {
    if (hooks.isFinished(phase.id)) {
      say.info(`fase ${phase.label}: já concluída, pulando`);
      continue;
    }
    const failure = await runOne(phase, context, hooks, say);
    if (failure) return failure;
  }
  return { ok: true };
}

async function runOne<Context, Id extends string>(phase: Phase<Context, Id>, context: Context, hooks: PhaseHooks<Id>, say: Say): Promise<RunResult<Id> | undefined> {
  hooks.started(phase.id);
  say.info(`fase ${phase.label}: iniciando`);
  try {
    const outcome = (await phase.run(context)) ?? {};
    if (outcome.skipped) {
      hooks.skipped(phase.id, outcome.skipped);
      say.info(`fase ${phase.label}: pulada (${outcome.skipped})`);
    } else {
      hooks.finished(phase.id, outcome.detail);
      say.success(`fase ${phase.label}: concluída`);
    }
    return undefined;
  } catch (error) {
    hooks.failed(phase.id, error);
    say.error(`fase ${phase.label}: falhou: ${messageOf(error)}`);
    return { ok: false, failedPhase: phase.id, error };
  }
}
