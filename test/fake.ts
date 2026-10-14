// A fake system for the install: an exec that records every call and answers from rules, an in-memory fs and store.
// Nothing real runs and nothing real is written.
import type { ExecResult, ModuleFs, Store } from "@pvx/sdk";
import type { InstallDeps } from "../src/install.ts";
import { DEFAULT_OPTIONS } from "../src/options.ts";
import type { RunOptions } from "../src/model.ts";
import type { Say } from "../src/runtime.ts";
import { dnfSuccessLines, type SamplePackage } from "./dnf-sample.ts";

export interface Call {
  cmd: string;
  args: string[];
  stdin?: string;
}
export interface Reply extends Partial<ExecResult> {
  lines?: string[];
}
export type Rule = (call: Call) => Reply | undefined;

export const lineOf = (call: Call) => `${call.cmd} ${call.args.join(" ")}`.trim();
const baseName = (path: string) => path.split("/").pop()!;

/** What a real `dnf install -y a b` would print for the names, as one package each. */
export const dnfFor = (names: string[]): string[] => dnfSuccessLines(names.map((name): SamplePackage => ({ name, version: "1.0-1.el8" })));

/** `events` keeps the order of writes, chmods and moves ("write /p empty", "chmod 600 /p"), so a test can check content never lands before the lock. */
export function fakeFs(initial: Record<string, string> = {}, events: string[] = []): ModuleFs & { files: Map<string, string>; writes: string[]; events: string[] } {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    files,
    writes,
    events,
    read: async (path) => {
      if (!files.has(path)) throw new Error(`sem arquivo ${path}`);
      return files.get(path)!;
    },
    write: async (path, data) => void (files.set(path, data), writes.push(path), events.push(`write ${path} ${data ? "content" : "empty"}`)),
    exists: async (path) => files.has(path),
    list: async () => [],
    remove: async (path) => void files.delete(path),
    append: async (path, text) => void files.set(path, (files.get(path) ?? "") + text),
  };
}

export function memStore(initial: Record<string, unknown> = {}): Store & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = structuredClone(initial);
  return {
    data,
    get: <T,>(key: string) => (data[key] === undefined ? undefined : (structuredClone(data[key]) as T)),
    set: (key, value) => void (data[key] = structuredClone(value)),
    delete: (key) => void delete data[key],
  };
}

export interface SaidLine {
  level: "info" | "success" | "warning" | "error" | "raw";
  text: string;
}

export function recordingSay(): Say & { lines: SaidLine[]; text(): string } {
  const lines: SaidLine[] = [];
  const at = (level: SaidLine["level"]) => (text: string) => void lines.push({ level, text });
  return { lines, info: at("info"), success: at("success"), warning: at("warning"), error: at("error"), raw: at("raw"), text: () => lines.map((line) => line.text).join("\n") };
}

export const HEALTHY_OS_RELEASE = 'NAME="Rocky Linux"\nVERSION_ID="8.10"\nID="rocky"\nID_LIKE="rhel centos fedora"\nPRETTY_NAME="Rocky Linux 8.10 (Green Obsidian)"\n';

export interface FakeSystem {
  exec: InstallDeps["exec"];
  calls: Call[];
  fs: ReturnType<typeof fakeFs>;
  store: ReturnType<typeof memStore>;
  say: ReturnType<typeof recordingSay>;
  deps: InstallDeps;
  /** Lines of the calls, in order ("dnf install -y a b"). */
  lines(): string[];
  /** Index of the first call that starts with `prefix`, or -1. */
  indexOf(prefix: string): number;
  clock: { now: number };
  installed: Set<string>;
}

export interface FakeOptions {
  rules?: Rule[];
  files?: Record<string, string>;
  store?: Record<string, unknown>;
  /** Packages a first run already installed. */
  installed?: Iterable<string>;
}

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

/** The first rule that answers: later rules are not asked (the dnf rule has side effects). */
function firstReply(rules: Rule[], call: Call): Reply {
  for (const rule of rules) {
    const reply = rule(call);
    if (reply) return reply;
  }
  return {};
}

/** `chmod` and `mv` act on the fake fs, so the atomic write of a secret file can be followed. */
function applyFileCommand(fs: ReturnType<typeof fakeFs>, call: Call): void {
  if (call.cmd === "chmod") fs.events.push(`chmod ${call.args.join(" ")}`);
  if (call.cmd !== "mv") return;
  const [from, to] = call.args.filter((arg) => !arg.startsWith("-")) as [string, string];
  fs.events.push(`mv ${from} ${to}`);
  fs.files.set(to, fs.files.get(from) ?? "");
  fs.files.delete(from);
}

export function fakeSystem(options: FakeOptions = {}): FakeSystem {
  const calls: Call[] = [];
  const fs = fakeFs({ "/etc/os-release": HEALTHY_OS_RELEASE, "/etc/passwd": "root:x:0:0\n", ...options.files });
  const store = memStore(options.store);
  const say = recordingSay();
  const clock = { now: 1_800_000_000_000 };
  const installed = new Set(options.installed);
  const rules = [...(options.rules ?? []), dnfRule(installed), hostnameRule];
  const exec: InstallDeps["exec"] = async (cmd, args = [], opts) => {
    const call: Call = { cmd: baseName(cmd), args, stdin: opts?.stdin };
    calls.push(call);
    applyFileCommand(fs, call);
    const reply = firstReply(rules, call);
    for (const line of reply.lines ?? []) opts?.onLine?.(line, "stdout");
    return { code: reply.code ?? 0, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "" };
  };
  const deps: InstallDeps = {
    exec,
    fs,
    store,
    say,
    paths: { assets: "/module/assets", stateDir: "/state" },
    signal: new AbortController().signal,
    now: () => clock.now,
    sleep: async (ms) => void (clock.now += ms),
  };
  return {
    exec, calls, fs, store, say, deps, clock, installed,
    lines: () => calls.map(lineOf),
    indexOf: (prefix) => calls.findIndex((call) => lineOf(call).startsWith(prefix)),
  };
}

export const OPTIONS: RunOptions = { ...DEFAULT_OPTIONS, addpkgs: ["licensed", "community-blocklist"], reboot: false };
export const PASSWORDS = { sql: "SqlSecretPassw0rdXyzAbcd1", web: "WebSecretPassw0rdQrsTuvw2" };
/** Makes any call that matches fail with `code` and `stderr`. */
export const failing = (match: (call: Call) => boolean, reply: Reply = { code: 1 }): Rule => (call) => (match(call) ? reply : undefined);
