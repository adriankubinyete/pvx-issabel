import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { ExecResult, ModuleFs } from "@pvx/sdk";
import { credentialsPath, formatCredentials, newCredentials, parseCredentials, saveCredentials } from "../src/credentials.ts";
import { executeInstall } from "../src/install.ts";
import { STORE_KEY } from "../src/state.ts";
import { DEFAULT_OPTIONS, jobLine } from "../src/options.ts";
import { createShell, type ExecFn } from "../src/exec.ts";
import { fakeSystem, OPTIONS, PASSWORDS } from "./fake.ts";

describe("the credentials file", () => {
  test("holds product, date, URL, users and passwords", () => {
    const credentials = { ...newCredentials(DEFAULT_OPTIONS, PASSWORDS, new Date("2026-10-14T15:02:00Z")), url: "https://203.0.113.10" };
    const text = formatCredentials(credentials);
    expect(text).toContain("produto=issabel5");
    expect(text).toContain("data=2026-10-14T15:02:00.000Z");
    expect(text).toContain("url=https://203.0.113.10");
    expect(text).toContain("usuario_web=admin");
    expect(text).toContain(`senha_web=${PASSWORDS.web}`);
    expect(text).toContain("usuario_mysql=root");
    expect(text).toContain(`senha_mysql_root=${PASSWORDS.sql}`);
    expect(parseCredentials(text)).toEqual(credentials);
  });
  test("a file without the passwords is not credentials", () => expect(parseCredentials("produto=issabel5\n")).toBeUndefined());
  test("the name carries the date", () => expect(credentialsPath(new Date("2026-10-14T15:02:00Z"), "/s")).toBe("/s/credenciais-20261014T1502.txt"));

  test("the install writes it 0600, lock first, content second, then renames", async () => {
    const system = fakeSystem();
    await executeInstall(system.deps, { mode: "fresh", options: OPTIONS, passwords: PASSWORDS });
    const path = system.store.get<{ credentialsFile: string }>(STORE_KEY.progress)!.credentialsFile;
    const events = system.fs.events.filter((event) => event.includes(`${path}.partial`) || event === `mv ${path}.partial ${path}`);
    expect(events.slice(0, 4)).toEqual([`write ${path}.partial empty`, `chmod 600 ${path}.partial`, `write ${path}.partial content`, `mv ${path}.partial ${path}`]);
    expect(system.fs.files.has(`${path}.partial`)).toBe(false);
    expect(system.fs.files.get(path)).toContain("url=https://203.0.113.10"); // completed by the passwords phase
  });

  /** Real files in a temp dir; only chmod and mv run, and only on that dir. */
  const realDisk = () => {
    const dir = mkdtempSync(join(tmpdir(), "issabel-cred-"));
    const modesAtContent: string[] = [];
    const fs: ModuleFs = {
      read: async (path) => readFileSync(path, "utf8"),
      exists: async (path) => existsSync(path),
      list: async () => [],
      remove: async (path) => rmSync(path, { force: true }),
      append: async () => {},
      write: async (path, data) => {
        if (data && existsSync(path)) modesAtContent.push((statSync(path).mode & 0o777).toString(8));
        writeFileSync(path, data);
      },
    };
    const exec: ExecFn = async (cmd, args = []): Promise<ExecResult> => {
      if (cmd === "chmod") chmodSync(args[1]!, Number.parseInt(args[0]!, 8));
      else if (cmd === "mv") renameSync(args[1]!, args[2]!);
      else throw new Error(`o teste não deixa rodar ${cmd}`);
      return { code: 0, stdout: "", stderr: "" };
    };
    return { dir, fs, modesAtContent, shell: createShell(exec, { info() {}, success() {}, warning() {}, error() {}, raw() {} }, new AbortController().signal) };
  };

  test("on a real disk the file is 0600, the content never lands in a wider file, and no partial is left", async () => {
    const { dir, fs, modesAtContent, shell } = realDisk();
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "credenciais.txt");
    await saveCredentials(shell, fs, path, newCredentials(DEFAULT_OPTIONS, PASSWORDS, new Date()));
    expect((statSync(path).mode & 0o777).toString(8)).toBe("600");
    expect(modesAtContent).toEqual(["600"]);
    expect(existsSync(`${path}.partial`)).toBe(false);
    expect(readFileSync(path, "utf8")).toContain(PASSWORDS.sql);
    await saveCredentials(shell, fs, path, { ...newCredentials(DEFAULT_OPTIONS, PASSWORDS, new Date()), url: "https://x" }); // the rewrite keeps the mode
    expect((statSync(path).mode & 0o777).toString(8)).toBe("600");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("secrets never leak", () => {
  const SECRETS = [PASSWORDS.sql, PASSWORDS.web];
  const leaks = (text: string) => SECRETS.filter((secret) => text.includes(secret));

  test("not in logs, the store, stdin, or any argv except the one tool that takes them", async () => {
    const system = fakeSystem();
    await executeInstall(system.deps, { mode: "fresh", options: { ...OPTIONS, reboot: true }, passwords: PASSWORDS });
    expect(leaks(system.say.text())).toEqual([]);
    expect(leaks(JSON.stringify(system.store.data))).toEqual([]);
    const others = system.calls.filter((call) => call.cmd !== "issabel-admin-passwords");
    expect(leaks(others.map((call) => `${call.cmd} ${call.args.join(" ")} ${call.stdin ?? ""}`).join("\n"))).toEqual([]);
    const tool = system.calls.find((call) => call.cmd === "issabel-admin-passwords")!;
    expect(tool.args).toEqual(["--cli", "init", PASSWORDS.sql, PASSWORDS.web]);
    expect(system.say.lines.find((line) => line.text.startsWith("$ /usr/bin/issabel-admin-passwords"))?.text).toBe("$ /usr/bin/issabel-admin-passwords --cli init ***");
  });
  test("not in the job line, nor in the progress or reboot plan", async () => {
    expect(leaks(jobLine(OPTIONS))).toEqual([]);
    const system = fakeSystem();
    await executeInstall(system.deps, { mode: "fresh", options: { ...OPTIONS, reboot: true }, passwords: PASSWORDS });
    expect(leaks(JSON.stringify(system.store.get(STORE_KEY.progress)))).toEqual([]);
    expect(leaks(JSON.stringify(system.store.get(STORE_KEY.reboot) ?? {}))).toEqual([]);
  });
  test("not in a failure record", async () => {
    const system = fakeSystem({ rules: [(call) => (call.cmd === "issabel-admin-passwords" ? { code: 1, lines: [`bad password ${PASSWORDS.sql}`] } : undefined)] });
    await executeInstall(system.deps, { mode: "fresh", options: OPTIONS, passwords: PASSWORDS });
    const error = (system.store.get(STORE_KEY.progress) as { error: { command: string } }).error;
    expect(error.command).toBe("/usr/bin/issabel-admin-passwords --cli init ***");
  });
});
