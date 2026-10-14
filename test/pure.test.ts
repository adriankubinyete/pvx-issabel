import { describe, expect, test } from "bun:test";
import type { PhasesState } from "@pvx/sdk";
import { causeOf, commandOf, DEFAULT_CAUSE, likelyCause } from "../src/failure.ts";
import { DEFAULT_OPTIONS, cliLine, generatePassword, jobLine, optionsFromAnswers, readOptions } from "../src/options.ts";
import { PHASES } from "../src/phases/index.ts";
import { checkLine, statusLines } from "../src/health/summary.ts";
import { fakeSdk } from "@pvx/testing";
import { isRhelLike, memTotalKb, parseOsRelease, passwdHasUser, systemName, versionMajor, withIpv6Guard, withPhpTimezone, withSelinuxDisabled } from "../src/text-edits.ts";

const reader = (args: Record<string, string | boolean | undefined>) => ({
  option: (name: string) => (typeof args[name] === "string" ? (args[name] as string) : undefined),
  flag: (name: string) => args[name] === true,
  list: (name: string) => (typeof args[name] === "string" ? (args[name] as string).split(",").map((item) => item.trim()).filter(Boolean) : []),
});

describe("options", () => {
  test("defaults: Asterisk 18, licensed + blocklist, São Paulo, reboot", () => {
    expect(readOptions(reader({}))).toEqual({ ok: true, options: DEFAULT_OPTIONS });
    expect(DEFAULT_OPTIONS).toMatchObject({ astver: "18", addpkgs: ["licensed", "community-blocklist"], timezone: "America/Sao_Paulo", reboot: true });
  });
  test("reads every flag", () => {
    const parsed = readOptions(reader({ astver: "16", addpkgs: "wanpipe", timezone: "America/Manaus", force: true, "skip-clean": true, "no-reboot": true }));
    expect(parsed).toEqual({ ok: true, options: { astver: "16", addpkgs: ["wanpipe"], timezone: "America/Manaus", force: true, skipClean: true, reboot: false } });
  });
  test("rejects a bad Asterisk, add-on or timezone with the cause", () => {
    expect(readOptions(reader({ astver: "17" }))).toEqual({ ok: false, error: "Asterisk inválido: 17 (use 16 ou 18)" });
    expect(readOptions(reader({ addpkgs: "licensed,bogus" }))).toMatchObject({ ok: false, error: expect.stringContaining("bogus") });
    expect(readOptions(reader({ timezone: "../../etc/passwd" }))).toMatchObject({ ok: false, error: expect.stringContaining("fuso inválido") });
    expect(readOptions(reader({ timezone: "America/Sao_Paulo; rm -rf" })).ok).toBe(false);
  });
  test("`--addpkgs none` means no extras", () => {
    expect(readOptions(reader({ addpkgs: "none" }))).toMatchObject({ ok: true, options: { addpkgs: [] } });
    expect(jobLine({ ...DEFAULT_OPTIONS, addpkgs: [] })).toContain("--addpkgs none");
  });
  test("the job line and the CLI line round-trip through the reader and carry no password", () => {
    const options = { ...DEFAULT_OPTIONS, astver: "16" as const, force: true, reboot: false };
    expect(jobLine(options)).toBe("netinstall run --astver 16 --addpkgs licensed,community-blocklist --timezone America/Sao_Paulo --force --no-reboot");
    expect(cliLine(options)).toBe("pvx issabel netinstall --astver 16 --addpkgs licensed,community-blocklist --timezone America/Sao_Paulo --force --no-reboot --yes");
    expect(jobLine(options)).not.toMatch(/password|senha/i);
  });
  test("options from the answers of the conversation", () => {
    expect(optionsFromAnswers({ astver: "16", addpkgs: "licensed,wanpipe", timezone: "America/Recife" })).toMatchObject({ astver: "16", addpkgs: ["licensed", "wanpipe"], timezone: "America/Recife" });
    expect(optionsFromAnswers({ astver: "x", addpkgs: "", timezone: "" })).toMatchObject({ astver: "18", addpkgs: [], timezone: "America/Sao_Paulo" });
  });
  test("generated passwords are 24 letters and digits, and differ", () => {
    const first = generatePassword();
    expect(first).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(generatePassword()).not.toBe(first);
  });
});

describe("text edits", () => {
  test("selinux", () => expect(withSelinuxDisabled("SELINUX=enforcing\nSELINUXTYPE=targeted\n")).toBe("SELINUX=disabled\nSELINUXTYPE=targeted\n"));
  test("ipv6 guard is idempotent and keeps a trailing newline", () => {
    const once = withIpv6Guard("a = 1");
    expect(once).toBe("a = 1\nnet.ipv6.conf.all.disable_ipv6 = 1\n");
    expect(withIpv6Guard(once)).toBe(once);
    expect(withIpv6Guard("")).toBe("net.ipv6.conf.all.disable_ipv6 = 1\n");
  });
  test("php timezone replaces a commented or set line, or appends", () => {
    expect(withPhpTimezone("x\n;date.timezone =\ny\n", "America/Sao_Paulo")).toBe("x\ndate.timezone = America/Sao_Paulo\ny\n");
    expect(withPhpTimezone("date.timezone = UTC\n", "America/Recife")).toBe("date.timezone = America/Recife\n");
    expect(withPhpTimezone("x\n", "America/Recife")).toBe("x\ndate.timezone = America/Recife\n");
  });
  test("passwd, os-release, meminfo", () => {
    expect(passwdHasUser("root:x:0\nasterisk:x:1\n", "asterisk")).toBe(true);
    expect(passwdHasUser("root:x:0\nasteriskx:x:1\n", "asterisk")).toBe(false);
    const release = parseOsRelease('NAME="Rocky Linux"\nVERSION_ID="8.10"\nID="rocky"\nID_LIKE="rhel centos fedora"\nPRETTY_NAME="Rocky Linux 8.10 (Green Obsidian)"');
    expect(isRhelLike(release)).toBe(true);
    expect(versionMajor(release)).toBe(8);
    expect(systemName(release)).toBe("Rocky Linux 8.10");
    expect(isRhelLike(parseOsRelease("ID=debian\n"))).toBe(false);
    expect(memTotalKb("MemTotal:  1000 kB\nSwapTotal: 500 kB\n")).toBe(1500);
    expect(memTotalKb("")).toBe(0);
  });
});

describe("failure", () => {
  test("a likely cause by the output", () => {
    expect(likelyCause(["ERROR 1045: Access denied for user 'root'"])).toContain("senha do MySQL");
    expect(likelyCause(["Curl error (6): Couldn't resolve host name"])).toContain("rede");
    expect(likelyCause(["Error: Unable to find a match: foo"])).toContain("repositórios");
    expect(likelyCause(["write error: No space left on device"])).toContain("disco");
    expect(likelyCause(["boom"])).toBe(DEFAULT_CAUSE);
  });
  test("a recorded failure shows its command, or its message when no command ran", () => {
    const stepFailure = { phase: "database", message: "x", command: "install_amp --installdb", code: 1, output: ["Access denied for user 'root'"] };
    expect(commandOf(stepFailure)).toBe("install_amp --installdb");
    expect(causeOf(stepFailure)).toContain("senha do MySQL");
    expect(commandOf({ phase: "repos", message: "boom" })).toBe("boom");
    expect(causeOf({ phase: "repos", message: "boom" })).toBe(DEFAULT_CAUSE);
  });
});

const PHASE_IDS = ["repos", "prepare", "php", "packages", "post", "database", "panel", "timezone", "passwords", "reboot"];

const stateOf = (states: Record<string, PhasesState["phases"][number]["state"]>): PhasesState => ({
  phases: PHASE_IDS.map((id) => ({ id, label: id, weight: 1, state: states[id] ?? "pending" })),
  startedAt: 1000,
  runStartedAt: 1000,
});

describe("the install phases", () => {
  test("they run in this order, and the reboot is the last", () => {
    expect(PHASES.map((phase) => phase.id)).toEqual(PHASE_IDS);
  });
  test("it is installed when everything but the restart is finished, even while the countdown runs", () => {
    const { phases } = fakeSdk();
    const done = Object.fromEntries(PHASE_IDS.filter((id) => id !== "reboot").map((id) => [id, "done" as const]));
    expect(phases.finished(stateOf({ ...done, reboot: "running" }), ["reboot"])).toBe(true);
    expect(phases.finished(stateOf({ ...done, passwords: "running" }), ["reboot"])).toBe(false);
    expect(phases.finished(stateOf({}), ["reboot"])).toBe(false);
  });
});

describe("status and check lines", () => {
  test("the phases, the packages and where it failed", () => {
    const state = { ...stateOf({ repos: "done", prepare: "failed" }), failure: { phase: "prepare", message: "x", command: "groupadd", output: [] } };
    const lines = statusLines(state, { total: 3, done: [], running: [], failed: ["a"] }, undefined, { progress: 0.456, installed: false });
    expect(lines[0]).toBe("✓ repos: concluída");
    expect(lines[1]).toBe("✗ prepare: falhou");
    expect(lines).toContain("pacotes: 0/3 instalados, 1 com falha");
    expect(lines).toContain("andamento: 46%");
    expect(lines).toContain("erro em prepare: groupadd");
    expect(lines.join("\n")).toContain("causa provável: ");
  });
  test("a check as a line of output", () => {
    expect(checkLine({ id: "memory", level: "warn", detail: "RAM+swap 1.4 G", message: "baixa" })).toEqual({ kind: "warning", text: "memória: RAM+swap 1.4 G: baixa" });
    expect(checkLine({ id: "root", level: "ok" })).toEqual({ kind: "success", text: "root" });
  });
});
