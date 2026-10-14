// Turning the progress into what the screens show: cells, steps, times, the text that gets copied. Pure.
import type { CellItem, StepItem } from "@pvx/sdk";
import type { Credentials } from "../credentials.ts";
import { PHASE_LABEL, type NetinstallProgress, type PackageProgress, type PackageRef, type PackageStage, type RebootPlan } from "../model.ts";
import { ADDON_LABEL } from "../packages.ts";
import { CHECK_LABEL, type Check, type CheckId } from "../preflight.ts";
import { elapsedOf } from "../progress.ts";

export const MASK = "●".repeat(12);

/** `m:ss`, the way the bar and the steps write times. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const pad2 = (value: number) => String(value).padStart(2, "0");
export const timeOfDay = (ms: number): string => `${pad2(new Date(ms).getHours())}:${pad2(new Date(ms).getMinutes())}`;
export const dateTime = (ms: number): string => {
  const date = new Date(ms);
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} ${timeOfDay(ms)}`;
};

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

export interface ShareInput {
  hostname: string;
  credentials: Credentials;
  installedAt: number;
  reboot?: RebootPlan;
  rebootSkipped: boolean;
}

function rebootLine({ reboot, rebootSkipped }: Pick<ShareInput, "reboot" | "rebootSkipped">): string {
  if (rebootSkipped) return "não reinicia sozinha (--no-reboot)";
  if (!reboot) return "—";
  return reboot.choice === "postponed" ? "adiado" : timeOfDay(reboot.at);
}

/** The block `c` copies on the done screen: ready to paste into a ticket or send to the customer. */
export function shareText(input: ShareInput): string {
  const { credentials } = input;
  const extras = credentials.addons.length ? credentials.addons.join(", ") : "nenhum";
  return [
    `Issabel 5 instalado em ${input.hostname} (${dateTime(input.installedAt)})`,
    `Acesso:      ${credentials.url ?? "—"}`,
    `Usuário web: ${credentials.webUser}`,
    `Senha web:   ${credentials.webPassword}`,
    `MySQL root:  ${credentials.mysqlPassword}`,
    `Asterisk ${credentials.asterisk} · pacotes: ${extras} · painel do operador`,
    `Reinício:    ${rebootLine(input)}`,
  ].join("\n");
}

export const addonSummary = (keys: (keyof typeof ADDON_LABEL)[]): string => (keys.length ? keys.map((key) => ADDON_LABEL[key]).join(", ") : "nenhum");

const checkOf = (checks: Check[], id: CheckId) => checks.find((check) => check.id === id);

/** The one-line recap of the checks that heads the questions: `root · Rocky Linux 8.10 · rede 120 ms · RAM+swap 1.4 G`. */
export function verificationSummary(checks: Check[]): string {
  const network = checkOf(checks, "network")?.detail;
  return [CHECK_LABEL.root, checkOf(checks, "system")?.detail, network && `rede ${network}`, checkOf(checks, "memory")?.detail].filter(Boolean).join(" · ");
}

/** Cuts `text` to `max` cells with a closing `…`. */
export const fit = (text: string, max: number): string => (text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text);

export interface RebootStatus {
  text: string;
  tone: "warn" | "info" | "dim";
  /** The countdown is still open: "reiniciar agora" and "adiar" make sense. */
  canAnswer: boolean;
}

/** After this long past the planned time the central is taken to have restarted. */
const REBOOTED_AFTER_MS = 2 * 60_000;

/** What the done screen says about the restart. `scheduled`: the reboot phase has not set its plan yet. */
export function rebootStatus(plan: RebootPlan | undefined, willReboot: boolean, now: number): RebootStatus {
  if (!willReboot) return { text: "▲ a central não reinicia sozinha (--no-reboot): reinicie quando puder", tone: "warn", canAnswer: false };
  if (!plan) return { text: "agendando o reinício…", tone: "dim", canAnswer: false };
  if (plan.choice === "postponed") return { text: "▲ reinício adiado: reinicie a central quando puder", tone: "warn", canAnswer: false };
  if (now > plan.at + REBOOTED_AFTER_MS) return { text: "a central já reiniciou", tone: "dim", canAnswer: false };
  if (plan.choice === "now" || now >= plan.at) return { text: "reiniciando a central…", tone: "info", canAnswer: false };
  return { text: `▲ reiniciando em ${clock(plan.at - now)}`, tone: "warn", canAnswer: true };
}
