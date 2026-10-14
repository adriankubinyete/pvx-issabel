// How the commands say things: the lines of `status` and `check`, built from the progress and the checks. Pure.
import type { OutLine } from "@pvx/sdk";
import { CHECK_LABEL, type Check } from "./preflight.ts";
import { PHASE_LABEL, type NetinstallProgress, type PhaseState } from "./model.ts";
import { overallProgress } from "./progress.ts";

const MARK_BY_STATE: Record<PhaseState, string> = { pending: "○", running: "▸", done: "✓", failed: "✗", skipped: "-" };
const WORD_BY_STATE: Record<PhaseState, string> = { pending: "pendente", running: "rodando", done: "concluída", failed: "falhou", skipped: "pulada" };
const KIND_BY_LEVEL: Record<Check["level"], OutLine["kind"]> = { ok: "success", warn: "warning", error: "error" };

export const checkLine = (check: Check): OutLine => ({
  kind: KIND_BY_LEVEL[check.level],
  text: [CHECK_LABEL[check.id], check.detail, check.level === "ok" ? undefined : check.message].filter(Boolean).join(": "),
});

export function statusLines(progress: NetinstallProgress): string[] {
  const lines = progress.phases.map((phase) => `${MARK_BY_STATE[phase.state]} ${PHASE_LABEL[phase.id]}: ${WORD_BY_STATE[phase.state]}${phase.detail ? ` (${phase.detail})` : ""}`);
  const { packages } = progress;
  lines.push(`pacotes: ${packages.done.length}/${packages.total} instalados, ${packages.failed.length} com falha`);
  lines.push(`andamento: ${Math.round(overallProgress(progress) * 100)}%`);
  if (progress.error) lines.push(`erro em ${PHASE_LABEL[progress.error.phase]}: ${progress.error.command}`, `causa provável: ${progress.error.cause}`);
  if (progress.credentialsFile) lines.push(`credenciais: ${progress.credentialsFile}`);
  return lines;
}
