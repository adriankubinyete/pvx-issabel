// The credentials file: product, date, URL, users and passwords, one `key=value` per line, 0600, in the module state dir.
// It is the only place the passwords are kept; they never reach argv (except the one tool that takes them there), logs or the store.
import type { ModuleFs } from "@pvx/sdk";
import type { RunOptions } from "./state.ts";
import { ADDON_LABEL } from "./packages.ts";
import { stateDir } from "./paths.ts";

/** A file that holds a secret is created with this mode (`ctx.fs.write` locks it before the content goes in). */
export const SECRET_MODE = 0o600;

export const PRODUCT = "issabel5";
export const WEB_USER = "admin";
export const MYSQL_USER = "root";

export interface Credentials {
  date: string;
  url?: string;
  webUser: string;
  webPassword: string;
  mysqlUser: string;
  mysqlPassword: string;
  asterisk: string;
  addons: string[];
}

type Field = keyof Credentials;

const FIELD_KEYS: Record<Field, string> = {
  date: "data",
  url: "url",
  webUser: "usuario_web",
  webPassword: "senha_web",
  mysqlUser: "usuario_mysql",
  mysqlPassword: "senha_mysql_root",
  asterisk: "asterisk",
  addons: "pacotes_extras",
};

const FIELDS = Object.keys(FIELD_KEYS) as Field[];

export function newCredentials(options: RunOptions, passwords: { sql: string; web: string }, now: Date): Credentials {
  return {
    date: now.toISOString(),
    webUser: WEB_USER,
    webPassword: passwords.web,
    mysqlUser: MYSQL_USER,
    mysqlPassword: passwords.sql,
    asterisk: options.astver,
    addons: options.addpkgs.map((key) => ADDON_LABEL[key]),
  };
}

export function formatCredentials(credentials: Credentials): string {
  const lines = [`produto=${PRODUCT}`];
  for (const field of FIELDS) {
    const value = credentials[field];
    if (value !== undefined) lines.push(`${FIELD_KEYS[field]}=${Array.isArray(value) ? value.join(",") : value}`);
  }
  return `${lines.join("\n")}\n`;
}

export function parseCredentials(text: string): Credentials | undefined {
  const pairs = new Map(text.split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as const));
  const get = (field: keyof Credentials) => pairs.get(FIELD_KEYS[field]);
  const webPassword = get("webPassword");
  const mysqlPassword = get("mysqlPassword");
  if (!webPassword || !mysqlPassword) return undefined;
  return {
    date: get("date") ?? "",
    url: get("url"),
    webUser: get("webUser") ?? WEB_USER,
    webPassword,
    mysqlUser: get("mysqlUser") ?? MYSQL_USER,
    mysqlPassword,
    asterisk: get("asterisk") ?? "",
    addons: (get("addons") ?? "").split(",").filter(Boolean),
  };
}

const stamp = (now: Date) => now.toISOString().replace(/[-:]/g, "").slice(0, 13);

export const credentialsPath = (now: Date, dir = stateDir()) => `${dir}/credenciais-${stamp(now)}.txt`;

/** Written beside the final path and renamed over it: a reader sees the old file or the new one whole, always 0600. */
export const saveCredentials = (fs: ModuleFs, path: string, credentials: Credentials) => fs.write(path, formatCredentials(credentials), { mode: SECRET_MODE, atomic: true });
