import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { ModuleDef } from "@pvx/sdk";
import { fakeReadCtx, fakeSdk, runSession } from "@pvx/testing";
import factory from "../src/index.tsx";
import { executeInstall } from "../src/install.ts";
import { checkOne } from "../src/preflight.ts";
import { fakeSystem, failing, OPTIONS, PASSWORDS } from "./fake.ts";
import { FIXTURE } from "./host.ts";

const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "pvx-module.json"), "utf8")) as { os: string[]; distro: string[]; permissions: { exec: string[]; fs: string[] }; contributes: { commands: string[]; pages: string[]; capabilities: string[] } };
const build = (): ModuleDef => factory(fakeSdk());
const baseName = (path: string) => path.split("/").pop()!;

describe("the manifest", () => {
  test("Linux, RHEL family, and the fixture manifest has the same permissions", () => {
    expect(manifest.os).toEqual(["linux"]);
    expect(manifest.distro).toEqual(["rhel"]);
    const fixture = JSON.parse(readFileSync(join(FIXTURE, "pvx-module.json"), "utf8"));
    expect(fixture.permissions).toEqual(manifest.permissions);
  });

  test("it lists exactly what the module runs: every program a scenario ran is allowed, and every allowed one ran", async () => {
    const used = new Set<string>();
    const run = async (system: ReturnType<typeof fakeSystem>, options = OPTIONS) => {
      await executeInstall(system.ctx, system.env, { mode: "fresh", options, passwords: PASSWORDS });
      system.calls.forEach((call) => used.add(call.cmd));
    };
    await run(fakeSystem({ files: { "/usr/local/fop2/create_fop2_manager_user.pl": "x" } }), { ...OPTIONS, reboot: true });
    await run(fakeSystem({ rules: [failing((call) => call.cmd === "timedatectl")] }));
    const probe = fakeSystem();
    for (const id of ["root", "system", "network", "memory", "previous"] as const) await checkOne(id, { exec: probe.exec, fs: probe.fs, isRoot: () => true, force: false });
    probe.calls.forEach((call) => used.add(call.cmd));
    // the capability and the central query run the probes of the read-only context
    const def = build();
    const capability = def.capabilities!.find((entry) => entry.id === "issabel.installed")!;
    const readOnly = fakeSystem({ files: { "/etc/issabel.conf": "x" } });
    await capability.prove(fakeReadCtx(readOnly));
    readOnly.calls.forEach((call) => used.add(call.cmd));
    used.add(baseName("hostname")); // the central query (covered by the page tests)
    const allowed = new Set(manifest.permissions.exec);
    expect([...used].filter((program) => !allowed.has(program))).toEqual([]);
    expect([...allowed].filter((program) => !used.has(program))).toEqual([]);
  });

  test("fs: the system files it reads and the three it edits, the module state dir is implied", () => {
    expect(manifest.permissions.fs.filter((entry) => entry.startsWith("rw:"))).toEqual(["rw:/etc/sysctl.conf", "rw:/etc/selinux/config", "rw:/etc/php.ini", "rw:$PVX_HOME/modules/issabel/state/"]);
  });

  test("it declares what it contributes", () => {
    const def = build();
    expect(Object.keys(def.commands!).sort()).toEqual([...manifest.contributes.commands].sort());
    expect(Object.keys(def.pages!)).toEqual(manifest.contributes.pages);
    expect(def.capabilities!.map((capability) => capability.id)).toEqual(manifest.contributes.capabilities);
    expect(def.pages!.issabel!.tab).toEqual({ label: "Issabel", order: 40 });
  });

  test("read-only commands are marked; the ones that change the central are destructive", () => {
    const { commands } = build();
    for (const key of ["netinstall status", "netinstall check"]) expect(commands![key]!.readonly).toBe(true);
    for (const key of ["netinstall", "netinstall stop", "netinstall reboot"]) expect(commands![key]!.destructive).toBe(true);
    for (const key of ["netinstall run", "netinstall resume", "netinstall postpone"]) expect(commands![key]!.readonly).toBeUndefined();
  });

  test("the passwords are secret args, never plain options", () => {
    const { args } = build().commands!.netinstall!;
    for (const name of ["sql-password", "web-password"]) expect(args!.find((arg) => arg.name === name)).toMatchObject({ kind: "option", secret: true });
    expect(args!.find((arg) => arg.name === "addpkgs")).toMatchObject({ repeat: true });
  });
});

describe("the capability issabel.installed", () => {
  const prove = async (options: Parameters<typeof fakeSystem>[0]) => {
    const system = fakeSystem(options);
    const capability = build().capabilities!.find((entry) => entry.id === "issabel.installed")!;
    return capability.prove(fakeReadCtx(system));
  };

  test("warns without asterisk, and without /etc/issabel.conf", async () => {
    expect(await prove({ rules: [failing((call) => call.cmd === "asterisk", { code: 127 })] })).toMatchObject({ level: "warn", fix: "issabel netinstall" });
    expect(await prove({})).toMatchObject({ level: "warn", text: expect.stringContaining("/etc/issabel.conf") });
  });
  test("ok with the versions as evidence", async () => {
    const result = await prove({ files: { "/etc/issabel.conf": "x" }, rules: [(call) => (call.cmd === "asterisk" ? { stdout: "Asterisk 18.20.2\n" } : call.cmd === "rpm" ? { stdout: "5.0.0-2" } : undefined)] });
    expect(result).toMatchObject({ level: "ok", evidence: "Asterisk 18.20.2 · issabel 5.0.0-2" });
  });
  test("its fix is opt-in: an install never starts on its own", () => {
    expect(build().capabilities![0]!.optIn).toBe(true);
  });
});

describe("the commands through the host", () => {
  test("netinstall run refuses without the passwords, and a bad option", async () => {
    const session = await runSession(FIXTURE);
    expect((await session.run("issabel netinstall run")).text).toContain("faltam as senhas");
    expect((await session.run("issabel netinstall run --timezone ../etc", { secrets: { "sql-password": "a", "web-password": "b" } })).text).toContain("fuso inválido");
  });
  test("status without any install", async () => {
    const session = await runSession(FIXTURE);
    const status = await session.run("issabel netinstall status");
    expect(status.text).toContain("job: none");
    expect(status.text).toContain("nenhuma instalação registrada");
  });
});
