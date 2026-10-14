import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createJobs, jobsDir, logsDir, readLogs } from "@pvx/core";
import { runSession, type Session } from "@pvx/testing";
import { PROGRESS_KEY, type NetinstallProgress } from "../src/model.ts";
import { FIXTURE, restoreHost, SECRETS, SQL_SECRET, stateDirOf, until, useDetachedJobs, WEB_SECRET } from "./host.ts";

let session: Session;
beforeEach(async () => {
  useDetachedJobs();
  session = await runSession(FIXTURE);
});
afterEach(restoreHost);

const jobs = () => createJobs("issabel");
const ended = () => until(() => jobs().status("netinstall"), (status) => status.state !== "running", 20_000);
const progressOf = () => JSON.parse(readFileSync(join(stateDirOf(session.home), "state.json"), "utf8")).progress as NetinstallProgress;
const everyFile = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)) : []);

describe("starting the install from the CLI", () => {
  test("validates, starts the job detached, follows the log and the job ends done", async () => {
    const result = await session.run("issabel netinstall --no-reboot --follow", { confirmed: true, secrets: SECRETS });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("root");
    expect(result.text).toContain("instalação iniciada em segundo plano");
    expect(result.text).toContain("fase repositórios: iniciando");
    expect(result.text).toContain("$ dnf install -y epel-release");
    expect(result.text).toContain("instalação concluída");
    const status = await jobs().status("netinstall");
    expect(status).toMatchObject({ state: "done", exit: 0 });
    expect(progressOf().phases.map((phase) => phase.state)).toEqual(["done", "done", "done", "done", "done", "done", "done", "done", "done", "skipped"]);
  }, 30_000);

  test("without --follow it says how to follow, and a second start is refused while it runs", async () => {
    process.env.ISSABEL_FAKE_DELAY_MS = "60";
    const first = await session.run("issabel netinstall --no-reboot", { confirmed: true, secrets: SECRETS });
    expect(first.text).toContain("pvx jobs log issabel netinstall -f");
    const second = await session.run("issabel netinstall --no-reboot", { confirmed: true, secrets: SECRETS });
    expect(second.ok).toBe(false);
    expect(second.text).toContain("já está rodando");
    await until(() => jobs().status("netinstall"), (status) => Boolean(status.pid));
    await jobs().stop("netinstall");
  }, 30_000);

  test("a destructive command needs --yes", async () => {
    const result = await session.run("issabel netinstall", { secrets: SECRETS });
    expect(result.exit).toBe(2);
  });

  test("a bad option fails before anything starts", async () => {
    const result = await session.run("issabel netinstall --astver 17", { confirmed: true });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("Asterisk inválido");
    expect((await jobs().status("netinstall")).state).toBe("none");
  });

  test("a blocking check stops it with the cause and the job never starts", async () => {
    process.env.ISSABEL_FAKE_PRESENT = "1";
    const result = await session.run("issabel netinstall", { confirmed: true });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("--force");
    expect((await jobs().status("netinstall")).state).toBe("none");
  });

  test("with --force it goes over an earlier install", async () => {
    process.env.ISSABEL_FAKE_PRESENT = "1";
    const result = await session.run("issabel netinstall --force --no-reboot --follow", { confirmed: true, secrets: SECRETS });
    expect(result.ok).toBe(true);
  }, 30_000);
});

describe("secrets", () => {
  test("the passwords reach the install and never the job state, the job log, the module log, the store or any file but the credentials", async () => {
    await session.run("issabel netinstall --no-reboot --follow", { confirmed: true, secrets: SECRETS });
    const credentials = everyFile(stateDirOf(session.home)).find((file) => file.includes("credenciais-"))!;
    expect(statSync(credentials).mode & 0o777).toBe(0o600);
    expect(readFileSync(credentials, "utf8")).toContain(`senha_mysql_root=${SQL_SECRET}`);
    expect(readFileSync(credentials, "utf8")).toContain("url=https://203.0.113.10");
    expect(existsSync(`${credentials}.partial`)).toBe(false);
    const others = [...everyFile(session.home), ...everyFile(logsDir())].filter((file) => file !== credentials && !file.endsWith(".sock"));
    for (const file of others) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toContain(SQL_SECRET);
      expect(text).not.toContain(WEB_SECRET);
    }
    expect(existsSync(join(jobsDir("issabel"), "netinstall.secrets"))).toBe(false);
    expect(readLogs({ logsDir: logsDir(), modules: ["issabel"], tail: 2000 }).join("\n")).not.toContain(SQL_SECRET);
  }, 30_000);

  test("a password is refused on argv", async () => {
    const result = await session.run(`issabel netinstall --sql-password ${SQL_SECRET}`, { confirmed: true });
    expect(result.ok).toBe(false);
    expect(result.text).not.toContain(SQL_SECRET);
  });

  test("without passwords the CLI generates them (the credentials file has 24 characters)", async () => {
    await session.run("issabel netinstall --no-reboot --follow", { confirmed: true });
    const credentials = everyFile(stateDirOf(session.home)).find((file) => file.includes("credenciais-"))!;
    expect(readFileSync(credentials, "utf8")).toMatch(/senha_mysql_root=[A-Za-z0-9]{24}\n/);
  }, 30_000);
});

describe("the job lifecycle: failure, status, resume, stop", () => {
  test("a failing phase fails the job, status says where and why, and the log has the output", async () => {
    process.env.ISSABEL_FAKE_FAIL_AT = "install_amp";
    await session.run("issabel netinstall --no-reboot", { confirmed: true, secrets: SECRETS });
    expect((await ended()).state).toBe("failed");
    const status = await session.run("issabel netinstall status");
    expect(status.text).toContain("job: failed");
    expect(status.text).toContain("✗ banco do IssabelPBX: falhou");
    expect(status.text).toContain("○ painel do operador: pendente");
    expect(status.text).toContain("causa provável");
    const log = (await jobs().log("netinstall")).join("\n");
    expect(log).toContain("boom: fake failure");
    expect(log).toContain("✗ fase banco do IssabelPBX: falhou");
    const module = readLogs({ logsDir: logsDir(), modules: ["issabel"], tail: 2000 }).join("\n");
    expect(module).toMatch(/ERROR issabel: \[job netinstall\] ✗ fase banco do IssabelPBX: falhou/);
    expect(module).toMatch(/INFO issabel: \[job netinstall\] i fase repositórios: iniciando/);
    expect(module).toMatch(/INFO issabel: \[job netinstall\] ✓ fase repositórios: concluída/);
    expect(module).toContain("falhou (exit 1)");
  }, 30_000);

  test("resume restarts the job from the failed phase, skipping the finished ones, with the passwords from the credentials file", async () => {
    process.env.ISSABEL_FAKE_FAIL_AT = "install_amp";
    await session.run("issabel netinstall --no-reboot", { confirmed: true, secrets: SECRETS });
    await ended();
    delete process.env.ISSABEL_FAKE_FAIL_AT;
    const resumed = await session.run("issabel netinstall resume --follow");
    expect(resumed.ok).toBe(true);
    expect(resumed.text).toContain("fase repositórios: já concluída, pulando");
    expect(resumed.text).toContain("fase pacotes: já concluída, pulando");
    expect(resumed.text).not.toContain("$ dnf install -y epel-release");
    expect(resumed.text).toContain("fase banco do IssabelPBX: concluída");
    expect((await jobs().status("netinstall")).state).toBe("done");
    expect(progressOf().phases.map((phase) => phase.state)).toEqual(["done", "done", "done", "done", "done", "done", "done", "done", "done", "skipped"]);
    expect(progressOf().error).toBeUndefined();
  }, 40_000);

  test("resume with no earlier install says so", async () => {
    const result = await session.run("issabel netinstall resume");
    expect(result.ok).toBe(false);
    expect(result.text).toContain("não há instalação para continuar");
  });

  test("stop ends the job (state stopped) and the install resumes afterwards", async () => {
    process.env.ISSABEL_FAKE_DELAY_MS = "40";
    await session.run("issabel netinstall --no-reboot", { confirmed: true, secrets: SECRETS });
    await until(() => session.run("issabel netinstall status"), (r) => r.text.includes("▸ "), 10_000);
    const stopped = await session.run("issabel netinstall stop", { confirmed: true });
    expect(stopped.text).toContain("instalação parada");
    expect((await jobs().status("netinstall")).state).toBe("stopped");
    delete process.env.ISSABEL_FAKE_DELAY_MS;
    const resumed = await session.run("issabel netinstall resume --follow");
    expect(resumed.ok).toBe(true);
    expect((await jobs().status("netinstall")).state).toBe("done");
  }, 40_000);

  test("check is read-only and lists every check; reboot and postpone refuse without a countdown", async () => {
    const check = await session.run("issabel netinstall check");
    expect(check.ok).toBe(true);
    expect(check.lines.map((line) => line.text.split(":")[0])).toEqual(["root", "sistema", "rede", "memória", "instalação anterior"]);
    expect((await session.run("issabel netinstall reboot", { confirmed: true })).text).toContain("não há reinício agendado");
    expect((await session.run("issabel netinstall postpone")).text).toContain("não há reinício agendado");
    expect(PROGRESS_KEY).toBe("progress");
  });

  test("the reboot countdown is answered from another process: postpone ends the job done, with the phase noted", async () => {
    await session.run("issabel netinstall", { confirmed: true, secrets: SECRETS });
    await until(() => session.run("issabel netinstall status"), (r) => r.text.includes("▸ reiniciar"), 20_000);
    await until(() => Promise.resolve(existsReboot()), Boolean, 5000);
    expect((await session.run("issabel netinstall postpone")).text).toContain("reinício adiado");
    expect((await ended()).state).toBe("done");
    expect(progressOf().phases.at(-1)).toMatchObject({ state: "done", detail: "adiado" });
  }, 40_000);

  const existsReboot = () => JSON.parse(readFileSync(join(stateDirOf(session.home), "state.json"), "utf8")).reboot !== undefined;
});
