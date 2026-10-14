import { describe, expect, test } from "bun:test";
import { blockingProblems, checkOne, runChecks, warnings, type PreflightDeps } from "../src/preflight.ts";
import { fakeSystem, failing, HEALTHY_OS_RELEASE, lineOf, type FakeOptions } from "./fake.ts";

const GOOD_MEMINFO = "MemTotal: 4000000 kB\nSwapTotal: 1000000 kB\n";
const depsOf = (options: FakeOptions = {}, extra: Partial<PreflightDeps> = {}) => {
  const system = fakeSystem({ ...options, files: { "/proc/meminfo": GOOD_MEMINFO, ...options.files } });
  const deps: PreflightDeps = { exec: system.exec, fs: system.fs, isRoot: true, force: false, ...extra };
  return { system, deps };
};

describe("each check", () => {
  test("root", async () => {
    expect((await checkOne("root", depsOf().deps)).level).toBe("ok");
    expect(await checkOne("root", depsOf({}, { isRoot: false }).deps)).toMatchObject({ level: "error", message: expect.stringContaining("root") });
  });
  test("Rocky 8.10 passes and names the system", async () => {
    expect(await checkOne("system", depsOf().deps)).toMatchObject({ level: "ok", detail: "Rocky Linux 8.10" });
  });
  test("Debian is refused, RHEL 7 is below the minimum", async () => {
    expect(await checkOne("system", depsOf({ files: { "/etc/os-release": "ID=debian\nVERSION_ID=12\n" } }).deps)).toMatchObject({ level: "error", message: expect.stringContaining("RHEL-like") });
    const old = depsOf({ files: { "/etc/os-release": 'ID="rhel"\nVERSION_ID="7.9"\nPRETTY_NAME="Red Hat 7.9"\n' } }).deps;
    expect(await checkOne("system", old)).toMatchObject({ level: "error", message: expect.stringContaining("8+") });
  });
  test("RHEL 9 and a CentOS-like id pass", async () => {
    expect((await checkOne("system", depsOf({ files: { "/etc/os-release": 'ID="almalinux"\nID_LIKE="rhel centos fedora"\nVERSION_ID="9.4"\n' } }).deps)).level).toBe("ok");
  });
  test("network: curl to the mirror with the 15 s timeout and 2 retries", async () => {
    const { system, deps } = depsOf();
    expect((await checkOne("network", deps)).level).toBe("ok");
    const curl = system.calls.find((call) => call.cmd === "curl")!;
    expect(curl.args).toContain("http://mirror.issabel.org");
    expect(curl.args.join(" ")).toContain("--max-time 15");
    expect(curl.args.join(" ")).toContain("--retry 2");
  });
  test("network down is an error that names the mirror", async () => {
    const { deps } = depsOf({ rules: [failing((call) => call.cmd === "curl", { code: 6 })] });
    expect(await checkOne("network", deps)).toMatchObject({ level: "error", message: expect.stringContaining("mirror.issabel.org") });
  });
  test("RAM+swap under 1536 MB is a warning, not an error", async () => {
    const { deps } = depsOf({ files: { "/proc/meminfo": "MemTotal: 1000000 kB\nSwapTotal: 400000 kB\n" } });
    const check = await checkOne("memory", deps);
    expect(check).toMatchObject({ level: "warn", message: expect.stringContaining("1367 MB") });
    expect(blockingProblems([check])).toEqual([]);
    expect(warnings([check])).toHaveLength(1);
  });
  test("exactly 1536 MB is enough; an unreadable meminfo does not block", async () => {
    expect((await checkOne("memory", depsOf({ files: { "/proc/meminfo": "MemTotal: 1572864 kB\nSwapTotal: 0 kB\n" } }).deps)).level).toBe("ok");
    expect((await checkOne("memory", depsOf({ files: { "/proc/meminfo": "" } }).deps)).level).toBe("ok");
  });
  test("a previous install (asterisk binary, or /etc/issabel.conf) is an error, unless forced", async () => {
    const withAsterisk = depsOf();
    expect((await checkOne("previous", withAsterisk.deps)).level).toBe("error"); // the fake asterisk answers 0
    const withConf = depsOf({ rules: [failing((call) => call.cmd === "asterisk", { code: 127 })], files: { "/etc/issabel.conf": "x" } });
    expect((await checkOne("previous", withConf.deps)).level).toBe("error");
    const forced = depsOf({ files: { "/etc/issabel.conf": "x" } }, { force: true });
    expect(await checkOne("previous", forced.deps)).toMatchObject({ level: "ok", detail: "detectada, ignorada por --force" });
  });
  test("a clean machine passes", async () => {
    const { deps } = depsOf({ rules: [failing((call) => call.cmd === "asterisk", { code: 127 })] });
    expect((await checkOne("previous", deps)).level).toBe("ok");
  });
});

describe("runChecks", () => {
  const clean = { rules: [failing((call) => call.cmd === "asterisk", { code: 127 })] };
  test("reports in order, one by one", async () => {
    const { deps } = depsOf(clean);
    const seen: string[] = [];
    const checks = await runChecks(deps, (check) => seen.push(check.id));
    expect(seen).toEqual(["root", "system", "network", "memory", "previous"]);
    expect(blockingProblems(checks)).toEqual([]);
  });
  test("without root nothing else runs (not even the network)", async () => {
    const { system, deps } = depsOf(clean, { isRoot: false });
    const checks = await runChecks(deps);
    expect(checks.map((check) => check.id)).toEqual(["root"]);
    expect(system.calls.map(lineOf)).toEqual([]);
  });
  test("collects every blocking problem and warning", async () => {
    const { deps } = depsOf({ ...clean, files: { "/etc/os-release": "ID=debian\n", "/proc/meminfo": "MemTotal: 100 kB\n" }, rules: [failing((call) => call.cmd === "curl", { code: 6 }), ...clean.rules] });
    const checks = await runChecks(deps);
    expect(blockingProblems(checks)).toHaveLength(2);
    expect(warnings(checks)).toHaveLength(1);
  });
  test("the healthy os-release constant is Rocky 8", () => expect(HEALTHY_OS_RELEASE).toContain("8.10"));
});
