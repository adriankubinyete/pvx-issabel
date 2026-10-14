// What the finished screens say: the text that is copied, the verification recap and the restart status. Pure.
import type { PhaseRecord, PhasesState } from "@pvx/sdk";
import type { Credentials } from "../credentials.ts";
import { CHECK_LABEL, type Check, type CheckId } from "../preflight.ts";
import { ADDON_LABEL } from "../packages.ts";
import { REBOOT_PHASE, type RebootPlan } from "../state.ts";
import { clock, dateTime, timeOfDay } from "./layout.ts";

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

const isFinished = (phase: PhaseRecord) => phase.state === "done" || phase.state === "skipped";

/** Everything but the restart is done: the done screen shows during the countdown, which is the last phase still running. */
export const isInstalled = (state: PhasesState): boolean => state.phases.filter((phase) => phase.id !== REBOOT_PHASE).every(isFinished);
