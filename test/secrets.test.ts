import { describe, expect, test } from "bun:test";
import { credentialsPath, formatCredentials, newCredentials, parseCredentials, SECRET_MODE } from "../src/credentials.ts";
import { executeInstall } from "../src/install.ts";
import { JOB_NAME, STORE_KEY, type InstallState } from "../src/state.ts";
import { DEFAULT_OPTIONS, jobLine } from "../src/options.ts";
import { fakeSystem, OPTIONS, PASSWORDS, type FakeSystem } from "./fake.ts";

const install = (system: FakeSystem, options = OPTIONS) => executeInstall(system.ctx, system.env, { mode: "fresh", options, passwords: PASSWORDS });

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

  test("the install writes it 0600 and atomically, first with the passwords and again with the URL", async () => {
    const system = fakeSystem();
    await install(system);
    const { credentialsFile: path } = system.store.get<InstallState>(STORE_KEY.install)!;
    const writes = system.writes.filter((write) => write.path === path);
    expect(writes).toHaveLength(2);
    for (const write of writes) expect(write.opts).toEqual({ mode: SECRET_MODE, atomic: true });
    expect(system.fs.modes.get(path!)).toBe(0o600);
    expect(system.lines().some((line) => line.startsWith("chmod 600") || line.startsWith("mv "))).toBe(false);
    expect(system.fs.files.get(path!)).toContain("url=https://203.0.113.10"); // completed by the passwords phase
  });
});

describe("secrets never leak", () => {
  const SECRETS = [PASSWORDS.sql, PASSWORDS.web];
  const leaks = (text: string) => SECRETS.filter((secret) => text.includes(secret));

  test("not in logs, the store, stdin, or any argv except the one tool that takes them", async () => {
    const system = fakeSystem();
    await install(system, { ...OPTIONS, reboot: true });
    expect(leaks(system.transcript())).toEqual([]);
    expect(leaks(JSON.stringify(system.store.data))).toEqual([]);
    const others = system.calls.filter((call) => call.cmd !== "issabel-admin-passwords");
    expect(leaks(others.map((call) => `${call.cmd} ${call.args.join(" ")} ${call.stdin ?? ""}`).join("\n"))).toEqual([]);
    const tool = system.calls.find((call) => call.cmd === "issabel-admin-passwords")!;
    expect(tool.args).toEqual(["--cli", "init", PASSWORDS.sql, PASSWORDS.web]);
    expect(system.ctx.jobLines.find((line) => line.startsWith("$ /usr/bin/issabel-admin-passwords"))).toBe("$ /usr/bin/issabel-admin-passwords --cli init ***");
  });
  test("not in the job line, nor in the progress or reboot plan", async () => {
    expect(leaks(jobLine(OPTIONS))).toEqual([]);
    const system = fakeSystem();
    await install(system, { ...OPTIONS, reboot: true });
    for (const key of [`phases:${JOB_NAME}`, STORE_KEY.install, STORE_KEY.packages]) expect(leaks(JSON.stringify(system.store.get(key)))).toEqual([]);
    expect(leaks(JSON.stringify(system.store.get(STORE_KEY.reboot) ?? {}))).toEqual([]);
  });
  test("not in a failure record", async () => {
    const system = fakeSystem({ rules: [(call) => (call.cmd === "issabel-admin-passwords" ? { code: 1, lines: [`bad password ${PASSWORDS.sql}`] } : undefined)] });
    await install(system);
    const { failure } = system.store.get(`phases:${JOB_NAME}`) as { failure: { command: string } };
    expect(failure.command).toBe("/usr/bin/issabel-admin-passwords --cli init ***");
  });
});
