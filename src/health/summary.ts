// How the commands say things: the lines of `status` and `check`, built from the progress and the checks. Pure.
import type { OutLine, PackageProgress, PhaseState, PhasesState } from "@pvx/sdk";
import { CHECK_LABEL, type Check } from "../preflight.ts";
import { causeOf, commandOf, phaseLabelOf } from "../failure.ts";
import type { InstallState } from "../state.ts";

const MARK_BY_STATE: Record<PhaseState, string> = { pending: "○", running: "▸", done: "✓", failed: "✗", skipped: "-" };
const WORD_BY_STATE: Record<PhaseState, string> = { pending: "pendente", running: "rodando", done: "concluída", failed: "falhou", skipped: "pulada" };
const KIND_BY_LEVEL: Record<Check["level"], OutLine["kind"]> = { ok: "success", warn: "warning", error: "error" };

export const checkLine = (check: Check): OutLine => ({
  kind: KIND_BY_LEVEL[check.level],
  text: [CHECK_LABEL[check.id], check.detail, check.level === "ok" ? undefined : check.message].filter(Boolean).join(": "),
});

export function statusLines(state: PhasesState, packages: PackageProgress | undefined, install: InstallState | undefined): string[] {
  const lines = state.phases.map((phase) => `${MARK_BY_STATE[phase.state]} ${phase.label}: ${WORD_BY_STATE[phase.state]}${phase.detail ? ` (${phase.detail})` : ""}`);
  if (packages) lines.push(`pacotes: ${packages.done.length}/${packages.total} instalados, ${packages.failed.length} com falha`);
  const { failure } = state;
  if (failure) lines.push(`erro em ${phaseLabelOf(state, failure.phase)}: ${commandOf(failure)}`, `causa provável: ${causeOf(failure)}`);
  if (install?.credentialsFile) lines.push(`credenciais: ${install.credentialsFile}`);
  return lines;
}
