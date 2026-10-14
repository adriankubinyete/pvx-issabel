// A fake central for the install: the fake system of `@pvx/testing` (exec, fs, store, command context) plus what is of this module,
// a dnf that remembers what it installed and the answers of `hostname`. Nothing real runs and nothing real is written.
import type { ModuleFs } from "@pvx/sdk";
import { callLine, fakeCommandCtx, fakeSdk, fakeSystem as fakeHost, type Call, type FakeCommandCtx, type FakeSystem as HostSystem, type Reply, type Rule } from "@pvx/testing";
import type { InstallEnv } from "../src/install.ts";
import { DEFAULT_OPTIONS } from "../src/options.ts";
import type { RunOptions } from "../src/state.ts";
import { dnfSuccessLines, type SamplePackage } from "./dnf-sample.ts";

export type { Call, Reply, Rule };

export const lineOf = callLine;
const baseName = (path: string) => path.split("/").pop()!;

/** What a real `dnf install -y a b` would print for the names, as one package each. */
export const dnfFor = (names: string[]): string[] => dnfSuccessLines(names.map((name): SamplePackage => ({ name, version: "1.0-1.el8" })));

export const HEALTHY_OS_RELEASE = 'NAME="Rocky Linux"\nVERSION_ID="8.10"\nID="rocky"\nID_LIKE="rhel centos fedora"\nPRETTY_NAME="Rocky Linux 8.10 (Green Obsidian)"\n';

/** A dnf that remembers what it installed: a name asked for again is "already installed", and a run with nothing new prints "Nothing to do." */
const dnfRule = (installed: Set<string>): Rule => (call) => {
  if (call.cmd !== "dnf" || call.args[0] !== "install") return undefined;
  const names = call.args.slice(2);
  const fresh = names.filter((name) => !installed.has(name));
  fresh.forEach((name) => installed.add(name));
  const already = names.filter((name) => installed.has(name) && !fresh.includes(name)).map((name) => `Package ${name}-1.0-1.el8.x86_64 is already installed.`);
  return { lines: fresh.length ? [...already, ...dnfFor(fresh)] : [...already, "Dependencies resolved.", "Nothing to do.", "Complete!"] };
};

const hostnameRule: Rule = (call) => {
  if (call.cmd !== "hostname") return undefined;
  return { stdout: call.args[0] === "-I" ? "203.0.113.10 \n" : "central-sp-01\n" };
};

export interface FakeOptions {
  rules?: Rule[];
  files?: Record<string, string>;
  store?: Record<string, unknown>;
  /** Packages a first run already installed. */
  installed?: Iterable<string>;
}

/** One `fs.write` the install made, with the options it asked for (`mode`, `atomic`). */
export interface WriteRecord {
  path: string;
  opts: Parameters<ModuleFs["write"]>[2];
}

export interface FakeSystem extends HostSystem {
  /** What `executeInstall` takes: the command context over this system, and the environment around it. */
  ctx: FakeCommandCtx;
  env: InstallEnv;
  writes: WriteRecord[];
  clock: { now: number };
  installed: Set<string>;
  /** Everything the install said: `ctx.out` and the job log. */
  transcript(): string;
}

/** The host's fake system with the commands of the machine seen by their base name (the module runs `/usr/bin/issabel-admin-passwords`). */
export function fakeSystem(options: FakeOptions = {}): FakeSystem {
  const installed = new Set(options.installed);
  const rules = [...(options.rules ?? []), dnfRule(installed), hostnameRule];
  const files = { "/etc/os-release": HEALTHY_OS_RELEASE, "/etc/passwd": "root:x:0:0\n", ...options.files };
  const host = fakeHost({ rules, files, store: options.store });
  const writes: WriteRecord[] = [];
  const write = host.fs.write;
  host.fs.write = async (path, data, opts) => {
    writes.push({ path, opts });
    await write(path, data, opts);
  };
  const system: HostSystem = { ...host, exec: (cmd, args, opts) => host.exec(baseName(cmd), args, opts) };
  const ctx = fakeCommandCtx(system);
  const clock = { now: 1_800_000_000_000 };
  const env: InstallEnv = {
    paths: { assets: "/module/assets", stateDir: "/state" },
    signal: new AbortController().signal,
    packages: fakeSdk().packages,
    now: () => clock.now,
    sleep: async (ms) => void (clock.now += ms),
  };
  const transcript = () => [...ctx.lines.map((line) => line.text), ...ctx.jobLines].join("\n");
  return { ...system, ctx, env, writes, clock, installed, transcript };
}

export const OPTIONS: RunOptions = { ...DEFAULT_OPTIONS, addpkgs: ["licensed", "community-blocklist"], reboot: false };
export const PASSWORDS = { sql: "SqlSecretPassw0rdXyzAbcd1", web: "WebSecretPassw0rdQrsTuvw2" };
/** Makes any call that matches fail with `code` and `stderr`. */
export const failing = (match: (call: Call) => boolean, reply: Reply = { code: 1 }): Rule => (call) => (match(call) ? reply : undefined);
