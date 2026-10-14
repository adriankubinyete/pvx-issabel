// What the lists of the live screen are made of: cells of the package wall and steps of the phases. Pure.
import type { CellItem, PackagePhase, PackageProgress, PackageRef, PhasesState, StepItem } from "@pvx/sdk";

export const PACKAGE_PHASE_WORD: Record<PackagePhase, string> = { download: "baixando", install: "instalando", verify: "verificando" };

export const packageTitle = (ref: PackageRef): string => (ref.version ? `${ref.name} ${ref.version}` : ref.name);

/** One cell per package of the install: done, then running, then failed, then the ones still to come (they have no name yet). */
export function cellsOf(packages: PackageProgress): CellItem[] {
  const done = packages.done.map((ref): CellItem => ({ id: ref.name, state: "done", label: `${packageTitle(ref)} · instalado` }));
  const running = packages.running.map((ref): CellItem => ({ id: ref.name, state: "running", label: `${packageTitle(ref)} · ${PACKAGE_PHASE_WORD[ref.phase]}` }));
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

/** The package step shows the count of the wall, which `useRun` does not know. */
export function withPackageCount(steps: StepItem[], packages: PackageProgress): StepItem[] {
  return steps.map((step) => (step.id === "packages" && step.state !== "pending" ? { ...step, detail: `${packages.done.length}/${packages.total}` } : step));
}

/** What the phase running now is called, for the "agora" line. */
export const runningLabelOf = (state: PhasesState): string => state.phases.find((phase) => phase.state === "running")?.label ?? "—";
