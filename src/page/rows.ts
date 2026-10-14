// What the lists of the live screen are made of: cells of the package wall and steps of the phases. Pure.
import type { CellItem, StepItem } from "@pvx/sdk";
import { PHASE_LABEL, type NetinstallProgress, type PackageProgress, type PackageRef, type PackageStage } from "../state.ts";
import { elapsedOf } from "../progress.ts";

export const STAGE_WORD: Record<PackageStage, string> = { downloading: "baixando", installing: "instalando", configuring: "configurando" };

export const packageTitle = (ref: PackageRef): string => (ref.version ? `${ref.name} ${ref.version}` : ref.name);

/** One cell per package of the install: done, then running, then failed, then the ones still to come (they have no name yet). */
export function cellsOf(packages: PackageProgress): CellItem[] {
  const done = packages.done.map((ref): CellItem => ({ id: ref.name, state: "done", label: `${packageTitle(ref)} · instalado` }));
  const running = packages.running.map((ref): CellItem => ({ id: ref.name, state: "running", label: `${packageTitle(ref)} · ${STAGE_WORD[ref.stage]}` }));
  const failed = packages.failed.map((name): CellItem => ({ id: `failed:${name}`, state: "failed", label: `${name} · falhou` }));
  const known = done.length + running.length + failed.length;
  const pending = Array.from({ length: Math.max(0, packages.total - known) }, (_, index): CellItem => ({ id: `pending:${index}`, state: "pending", label: "aguardando" }));
  return [...done, ...running, ...failed, ...pending];
}

/** What the line under the grid adds about the package behind a cell id (the grid's own label has name, version and state). */
export function packageDetail(packages: PackageProgress, id: string): string | undefined {
  const known = [...packages.done, ...packages.running].find((ref) => ref.name === id);
  if (known) return [known.name, known.arch, known.repo, known.size].filter(Boolean).join(" · ");
  if (id.startsWith("failed:")) return `${id.slice("failed:".length)} · falhou: veja o log`;
  return id.startsWith("pending:") ? "aguardando a vez" : undefined;
}

export function stepsOf(progress: NetinstallProgress, now: number): StepItem[] {
  return progress.phases.map((phase): StepItem => ({
    id: phase.id,
    label: PHASE_LABEL[phase.id],
    state: phase.state,
    elapsedMs: elapsedOf(phase, now),
    detail: stepDetail(progress, phase.id, phase.state),
  }));
}

function stepDetail(progress: NetinstallProgress, id: string, state: string): string | undefined {
  if (id === "packages" && state !== "pending") return `${progress.packages.done.length}/${progress.packages.total}`;
  return progress.phases.find((phase) => phase.id === id)?.detail;
}
