import { describe, expect, test } from "bun:test";
import { failureOf, likelyCause, DEFAULT_CAUSE } from "../src/failure.ts";
import { DEFAULT_OPTIONS, cliLine, generatePassword, jobLine, optionsFromAnswers, readOptions } from "../src/options.ts";
import { PHASE_IDS, type NetinstallProgress } from "../src/state.ts";
import { PHASES } from "../src/phases/index.ts";
import { failPhase, finishPhase, newProgress, overallProgress, prepareResume, startPhase, viewOf } from "../src/progress.ts";
import { checkLine, statusLines } from "../src/health/summary.ts";
import { StepError, describeCommand, relevantOutput } from "../src/exec.ts";
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
  test("a StepError becomes the failure record; any other error keeps its message", () => {
    expect(failureOf("database", new StepError("x", "install_amp --installdb", 1, ["Access denied for user 'root'"]))).toMatchObject({ phase: "database", command: "install_amp --installdb", code: 1 });
    expect(failureOf("repos", new Error("boom"))).toMatchObject({ command: "boom", output: [], cause: DEFAULT_CAUSE });
  });
  test("the shown command is cut and the shown output prefers error lines", () => {
    expect(describeCommand("dnf", ["install", "-y", ...Array(60).fill("package")]).length).toBeLessThanOrEqual(110);
    expect(relevantOutput(["a", "b", "Error: bad thing", "c"])).toEqual(["Error: bad thing"]);
    expect(relevantOutput(["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("the progress model", () => {
  const started = () => newProgress(DEFAULT_OPTIONS, 1000);
  test("the phases of the model are the phases the install runs, in order", () => {
    expect(PHASES.map((phase) => phase.id)).toEqual([...PHASE_IDS]);
    expect(started().phases.map((phase) => phase.id)).toEqual([...PHASE_IDS]);
  });
  test("the global value follows the weights and the package count", () => {
    const progress = started();
    expect(overallProgress(progress)).toBe(0);
    for (const id of ["repos", "prepare", "php"] as const) finishPhase(progress, id, 2000);
    startPhase(progress, "packages", 2000);
    progress.packages.total = 100;
    progress.packages.done = Array.from({ length: 50 }, (_, i) => ({ name: `p${i}`, version: "1" }));
    expect(overallProgress(progress)).toBeCloseTo((4 + 1 + 3 + 35) / 100, 5);
  });
  test("a failed phase keeps the credit earned", () => {
    const progress = started();
    for (const id of ["repos", "prepare"] as const) finishPhase(progress, id, 2000);
    failPhase(progress, "php", 3000, { phase: "php", command: "x", output: [], cause: "y" });
    expect(overallProgress(progress)).toBeCloseTo(5 / 100, 5);
  });
  test("the view: running, failed, done (even after the job went away at the reboot)", () => {
    const progress = started();
    expect(viewOf(progress, "running")).toBe("running");
    expect(viewOf(progress, "stopped")).toBe("failed");
    expect(viewOf(progress, "failed")).toBe("failed");
    failPhase(progress, "repos", 2000, { phase: "repos", command: "x", output: [], cause: "y" });
    expect(viewOf(progress, "running")).toBe("failed");
    const finished = started();
    for (const id of PHASE_IDS.filter((phase) => phase !== "reboot")) finishPhase(finished, id, 2000);
    expect(viewOf(finished, "failed")).toBe("done");
    expect(viewOf(finished, "none")).toBe("done");
  });
  test("a resume sends running and failed phases back to pending and clears the live package state", () => {
    const progress = started();
    finishPhase(progress, "repos", 2000);
    startPhase(progress, "prepare", 2000);
    progress.packages.running = [{ name: "a", version: "1", stage: "installing" }];
    prepareResume(progress, 5000);
    expect(progress.runStartedAt).toBe(5000);
    expect(progress.phases.map((phase) => phase.state).slice(0, 3)).toEqual(["done", "pending", "pending"]);
    expect(progress.packages.running).toEqual([]);
  });
  test("status and check lines", () => {
    const progress: NetinstallProgress = started();
    finishPhase(progress, "repos", 2000);
    failPhase(progress, "prepare", 3000, { phase: "prepare", command: "groupadd", output: [], cause: "causa" });
    const lines = statusLines(progress);
    expect(lines[0]).toBe("✓ repositórios: concluída");
    expect(lines[1]).toBe("✗ preparo do sistema: falhou");
    expect(lines.join("\n")).toContain("causa provável: causa");
    expect(checkLine({ id: "memory", level: "warn", detail: "RAM+swap 1.4 G", message: "baixa" })).toEqual({ kind: "warning", text: "memória: RAM+swap 1.4 G: baixa" });
    expect(checkLine({ id: "root", level: "ok" })).toEqual({ kind: "success", text: "root" });
  });
});
