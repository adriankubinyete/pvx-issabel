import { describe, expect, test } from "bun:test";
import { newCredentials } from "../src/credentials.ts";
import { DEFAULT_OPTIONS } from "../src/options.ts";
import { clock, dateTime, fit } from "../src/page/layout.ts";
import { rebootStatus, shareText, verificationSummary } from "../src/page/outcome.ts";
import { cellsOf, packageDetail, stepsOf } from "../src/page/rows.ts";
import { donePackages, failedAtDatabase, installing, NOW } from "./samples.ts";
import { PASSWORDS } from "./fake.ts";

describe("clock and text", () => {
  test("m:ss", () => {
    expect(clock(41_000)).toBe("0:41");
    expect(clock(12 * 60_000 + 4000)).toBe("12:04");
    expect(clock(-5)).toBe("0:00");
  });
  test("fit cuts with an ellipsis", () => {
    expect(fit("abcdef", 4)).toBe("abc…");
    expect(fit("abc", 4)).toBe("abc");
  });
  test("a local date and time", () => expect(dateTime(new Date(2026, 9, 14, 15, 21).getTime())).toBe("14/10/2026 15:21"));
});

describe("the package wall", () => {
  test("done, running, failed, then the ones still to come, by total", () => {
    const cells = cellsOf(installing().packages);
    expect(cells).toHaveLength(181);
    expect(cells.filter((cell) => cell.state === "done")).toHaveLength(96);
    expect(cells.filter((cell) => cell.state === "running").map((cell) => cell.id)).toEqual(["php-imap", "issabel-pbx", "asterisk18-sip"]);
    expect(cells.filter((cell) => cell.state === "failed").map((cell) => cell.id)).toEqual(["failed:wanpipe-utils"]);
    expect(cells.filter((cell) => cell.state === "pending")).toHaveLength(81);
    expect(new Set(cells.map((cell) => cell.id)).size).toBe(181);
    expect(cells.find((cell) => cell.id === "php-imap")!.label).toBe("php-imap 7.4.33-1.el8.remi · baixando");
  });
  test("a package that failed contiguous with the done ones when the install stopped", () => {
    const cells = cellsOf({ total: 5, done: donePackages(3), running: [], failed: ["x"] });
    expect(cells.map((cell) => cell.state)).toEqual(["done", "done", "done", "failed", "pending"]);
  });
  test("the detail line adds arch, repo and size", () => {
    expect(packageDetail(installing().packages, "pacote-4")).toBe("pacote-4 · x86_64 · baseos · 120 k");
    expect(packageDetail(installing().packages, "failed:wanpipe-utils")).toContain("falhou");
    expect(packageDetail(installing().packages, "pending:3")).toBe("aguardando a vez");
    expect(packageDetail(installing().packages, "nada")).toBeUndefined();
  });
});

describe("the phases as steps", () => {
  test("labels, states, the package count and the elapsed time", () => {
    const steps = stepsOf(installing(), NOW);
    expect(steps.map((step) => step.label)).toEqual(["repositórios", "preparo do sistema", "PHP 7.4 (Remi)", "pacotes", "pós-instalação", "banco do IssabelPBX", "painel do operador", "fuso horário", "senhas", "reiniciar"]);
    expect(steps.find((step) => step.id === "packages")).toMatchObject({ state: "running", detail: "96/181" });
    expect(steps.find((step) => step.id === "repos")).toMatchObject({ state: "done", elapsedMs: 60_000 });
    expect(steps.find((step) => step.id === "reboot")).toMatchObject({ state: "pending", elapsedMs: undefined });
    expect(stepsOf(failedAtDatabase(), NOW).find((step) => step.id === "database")!.state).toBe("failed");
  });
});

describe("the text that is copied", () => {
  const credentials = { ...newCredentials(DEFAULT_OPTIONS, PASSWORDS, new Date(NOW)), url: "https://203.0.113.10" };
  const at = new Date(2026, 9, 14, 15, 21).getTime();
  test("central, date, URL, user, passwords, Asterisk, packages and the reboot time", () => {
    const text = shareText({ hostname: "central-sp-01", credentials, installedAt: at, reboot: { at: new Date(2026, 9, 14, 15, 22).getTime(), choice: "wait" }, rebootSkipped: false });
    expect(text.split("\n")).toEqual([
      "Issabel 5 instalado em central-sp-01 (14/10/2026 15:21)",
      "Acesso:      https://203.0.113.10",
      "Usuário web: admin",
      `Senha web:   ${PASSWORDS.web}`,
      `MySQL root:  ${PASSWORDS.sql}`,
      "Asterisk 18 · pacotes: licenciados, blocklist · painel do operador",
      "Reinício:    15:22",
    ]);
  });
  test("a postponed or skipped reboot is said in words", () => {
    const base = { hostname: "h", credentials, installedAt: at };
    expect(shareText({ ...base, reboot: { at, choice: "postponed" }, rebootSkipped: false })).toContain("Reinício:    adiado");
    expect(shareText({ ...base, rebootSkipped: true })).toContain("não reinicia sozinha (--no-reboot)");
  });
  test("no extras reads as none; a missing URL as a dash", () => {
    const bare = { ...credentials, addons: [], url: undefined };
    const text = shareText({ hostname: "h", credentials: bare, installedAt: at, rebootSkipped: true });
    expect(text).toContain("pacotes: nenhum");
    expect(text).toContain("Acesso:      —");
  });
});

describe("the reboot status", () => {
  const plan = (choice: "wait" | "now" | "postponed", at: number) => ({ at, choice });
  test("the countdown, with the answer open", () => {
    expect(rebootStatus(plan("wait", NOW + 45_000), true, NOW)).toEqual({ text: "▲ reiniciando em 0:45", tone: "warn", canAnswer: true });
  });
  test("now, postponed, no plan yet, --no-reboot and long ago", () => {
    expect(rebootStatus(plan("now", NOW + 45_000), true, NOW)).toMatchObject({ text: "reiniciando a central…", canAnswer: false });
    expect(rebootStatus(plan("wait", NOW - 1000), true, NOW)).toMatchObject({ text: "reiniciando a central…", canAnswer: false });
    expect(rebootStatus(plan("postponed", NOW), true, NOW).text).toContain("reinício adiado");
    expect(rebootStatus(undefined, true, NOW)).toMatchObject({ text: "agendando o reinício…", canAnswer: false });
    expect(rebootStatus(undefined, false, NOW).text).toContain("--no-reboot");
    expect(rebootStatus(plan("wait", NOW - 10 * 60_000), true, NOW).text).toBe("a central já reiniciou");
  });
});

test("the verification recap", () => {
  expect(
    verificationSummary([
      { id: "root", level: "ok" },
      { id: "system", level: "ok", detail: "Rocky Linux 8.10" },
      { id: "network", level: "ok", detail: "120 ms" },
      { id: "memory", level: "warn", detail: "RAM+swap 1.4 G", message: "baixa" },
    ]),
  ).toBe("root · Rocky Linux 8.10 · rede 120 ms · RAM+swap 1.4 G");
});
