// The progress model of an install: building it, moving phases and reading it back as percentages and cells. Pure.
import { PHASE_IDS, PHASE_WEIGHT, type NetinstallProgress, type NetinstallView, type PackageProgress, type PhaseId, type PhaseRecord, type RunOptions } from "./state.ts";
import { emptyPackages } from "./dnf.ts";

export const newProgress = (options: RunOptions, now: number): NetinstallProgress => ({
  phases: PHASE_IDS.map((id) => ({ id, state: "pending" })),
  packages: emptyPackages(),
  startedAt: now,
  runStartedAt: now,
  options,
});

const recordOf = (progress: NetinstallProgress, id: PhaseId): PhaseRecord => progress.phases.find((phase) => phase.id === id)!;

export function startPhase(progress: NetinstallProgress, id: PhaseId, now: number): void {
  Object.assign(recordOf(progress, id), { state: "running", startedAt: now, endedAt: undefined, detail: undefined });
  progress.phase = id;
  progress.error = undefined;
}

export function finishPhase(progress: NetinstallProgress, id: PhaseId, now: number, detail?: string): void {
  Object.assign(recordOf(progress, id), { state: "done", endedAt: now, detail });
}

export function skipPhase(progress: NetinstallProgress, id: PhaseId, detail?: string): void {
  Object.assign(recordOf(progress, id), { state: "skipped", detail });
}

export function failPhase(progress: NetinstallProgress, id: PhaseId, now: number, error: NonNullable<NetinstallProgress["error"]>): void {
  Object.assign(recordOf(progress, id), { state: "failed", endedAt: now });
  progress.phase = id;
  progress.error = error;
}

const isFinished = (phase: PhaseRecord) => phase.state === "done" || phase.state === "skipped";
export const isPhaseFinished = (progress: NetinstallProgress, id: PhaseId) => isFinished(recordOf(progress, id));

/** Where a resumed run begins: a phase that was running when the job died is redone, so it goes back to pending. */
export function prepareResume(progress: NetinstallProgress, now: number): void {
  progress.runStartedAt = now;
  for (const phase of progress.phases.filter((record) => !isFinished(record))) Object.assign(phase, { state: "pending", startedAt: undefined, endedAt: undefined, detail: undefined });
  progress.packages.running = [];
  progress.packages.failed = [];
  progress.error = undefined;
}

/** What `jobs.status` says, as the page needs it. */
export interface JobSnapshot {
  state: "running" | "done" | "failed" | "stopped" | "none";
  startedAt?: number;
}

/** A progress written by an older job than the one the host knows is stale: the page must not show it as this run. */
export const isCurrentProgress = (progress: NetinstallProgress | undefined, job: JobSnapshot): progress is NetinstallProgress =>
  progress !== undefined && (job.startedAt === undefined || progress.runStartedAt >= job.startedAt);

type JobState = "running" | "done" | "failed" | "stopped" | "none";

const installFinished = (progress: NetinstallProgress) => PHASE_IDS.filter((id) => id !== "reboot").every((id) => isPhaseFinished(progress, id));

/** What the page shows. A finished install stays "done" even after the job (or the central) went away at the reboot. */
export function viewOf(progress: NetinstallProgress, jobState: JobState): NetinstallView {
  if (progress.error) return "failed";
  if (installFinished(progress)) return "done";
  return jobState === "running" ? "running" : "failed";
}

const packageFraction = (packages: PackageProgress) => (packages.total > 0 ? Math.min(1, packages.done.length / packages.total) : 0);

const phaseCredit = (progress: NetinstallProgress, phase: PhaseRecord): number => {
  if (isFinished(phase)) return 1;
  if (phase.state === "running" && phase.id === "packages") return packageFraction(progress.packages);
  return 0;
};

/** 0..1 across the whole install, by the weight of each phase. A failed phase keeps the credit it earned. */
export function overallProgress(progress: NetinstallProgress): number {
  const total = PHASE_IDS.reduce((sum, id) => sum + PHASE_WEIGHT[id], 0);
  const earned = progress.phases.reduce((sum, phase) => sum + PHASE_WEIGHT[phase.id] * phaseCredit(progress, phase), 0);
  return earned / total;
}

export const elapsedOf = (phase: PhaseRecord, now: number): number | undefined => (phase.startedAt === undefined ? undefined : (phase.endedAt ?? now) - phase.startedAt);
