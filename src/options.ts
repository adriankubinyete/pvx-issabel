// Reading, checking and writing back the options of an install. Pure: no exec, fs or store.
import type { ArgSpec, CommandCtx } from "@pvx/sdk";
import type { AddonKey, AsteriskVersion, RunOptions } from "./model.ts";
import { ADDON_KEYS, ASTERISK_VERSIONS, DEFAULT_ADDONS, DEFAULT_ASTVER, DEFAULT_TIMEZONE } from "./packages.ts";

type ArgReader = Pick<CommandCtx, "option" | "flag" | "list">;
export type OptionsResult = { ok: true; options: RunOptions } | { ok: false; error: string };

export const DEFAULT_OPTIONS: RunOptions = {
  astver: DEFAULT_ASTVER,
  addpkgs: DEFAULT_ADDONS,
  timezone: DEFAULT_TIMEZONE,
  force: false,
  skipClean: false,
  reboot: true,
};

/** `Area/City`, with the characters a zoneinfo path can hold: the value ends up in a path (`ln -sf`). */
const TIMEZONE_PATTERN = /^[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)*$/;
const PASSWORD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const PASSWORD_LENGTH = 24;
/** Largest multiple of the alphabet size under 256: bytes above it are discarded so every character is equally likely. */
const UNBIASED_LIMIT = 256 - (256 % PASSWORD_ALPHABET.length);

export const isAsteriskVersion = (value: string): value is AsteriskVersion => ASTERISK_VERSIONS.some((version) => version === value);
export const isAddonKey = (value: string): value is AddonKey => ADDON_KEYS.some((key) => key === value);
/** `--addpkgs none`: no extra package at all (an empty list would mean "the defaults"). */
export const NO_ADDONS = "none";

export const isTimezone = (value: string) => TIMEZONE_PATTERN.test(value);

export function generatePassword(): string {
  let password = "";
  while (password.length < PASSWORD_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(PASSWORD_LENGTH))) {
      if (byte < UNBIASED_LIMIT && password.length < PASSWORD_LENGTH) password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
    }
  }
  return password;
}

/** A blank or missing password becomes a generated one. */
export const passwordOrGenerated = (value: string | undefined): string => value || generatePassword();

const invalidAstver = (value: string) => `Asterisk inválido: ${value} (use ${ASTERISK_VERSIONS.join(" ou ")})`;
const invalidAddon = (value: string) => `pacote extra inválido: ${value} (use ${ADDON_KEYS.join(", ")})`;
const invalidTimezone = (value: string) => `fuso inválido: ${value} (use o formato Area/Cidade)`;

function readAstver(reader: ArgReader): string | undefined {
  const value = reader.option("astver");
  if (value === undefined) return undefined;
  return isAsteriskVersion(value) ? undefined : invalidAstver(value);
}

function readAddons(reader: ArgReader): string | undefined {
  const bad = reader.list("addpkgs").find((value) => value !== NO_ADDONS && !isAddonKey(value));
  return bad === undefined ? undefined : invalidAddon(bad);
}

function readTimezone(reader: ArgReader): string | undefined {
  const value = reader.option("timezone");
  if (value === undefined) return undefined;
  return isTimezone(value) ? undefined : invalidTimezone(value);
}

const astverOf = (value: string | undefined): AsteriskVersion => (value !== undefined && isAsteriskVersion(value) ? value : DEFAULT_OPTIONS.astver);

/** The options of `netinstall` and `netinstall run`: the first problem, or the options with the defaults filled in. */
export function readOptions(reader: ArgReader): OptionsResult {
  const error = readAstver(reader) ?? readAddons(reader) ?? readTimezone(reader);
  if (error) return { ok: false, error };
  const addpkgs = reader.list("addpkgs").filter(isAddonKey);
  const none = reader.list("addpkgs").includes(NO_ADDONS);
  return {
    ok: true,
    options: {
      astver: astverOf(reader.option("astver")),
      addpkgs: addpkgs.length || none ? addpkgs : DEFAULT_OPTIONS.addpkgs,
      timezone: reader.option("timezone") ?? DEFAULT_OPTIONS.timezone,
      force: reader.flag("force"),
      skipClean: reader.flag("skip-clean"),
      reboot: !reader.flag("no-reboot"),
    },
  };
}

/** The arguments shared by `netinstall` and `netinstall run`. */
export const OPTION_ARGS: ArgSpec[] = [
  { name: "astver", help: "Versão do Asterisk (16 ou 18; padrão 18)", kind: "option", values: [...ASTERISK_VERSIONS] },
  { name: "addpkgs", help: "Pacotes extras (repetível): licensed, community-blocklist, wanpipe", kind: "option", repeat: true, values: [...ADDON_KEYS, NO_ADDONS] },
  { name: "timezone", help: `Fuso horário (padrão ${DEFAULT_TIMEZONE})`, kind: "option" },
  { name: "sql-password", help: "Senha do root do MySQL (segredo; vazia = gerar)", kind: "option", secret: true },
  { name: "web-password", help: "Senha do admin da web (segredo; vazia = gerar)", kind: "option", secret: true },
  { name: "force", help: "Instala mesmo com Issabel/Asterisk já presente", kind: "flag" },
  { name: "skip-clean", help: "Pula `dnf clean all` (só para repetir numa máquina de teste)", kind: "flag" },
  { name: "no-reboot", help: "Não reinicia a central ao terminar", kind: "flag" },
];

/** The words of an options line: the same flags the CLI takes. */
export function optionWords(options: RunOptions): string[] {
  const addons = options.addpkgs.length ? options.addpkgs.join(",") : NO_ADDONS;
  const words = ["--astver", options.astver, "--addpkgs", addons, "--timezone", options.timezone];
  if (options.force) words.push("--force");
  if (options.skipClean) words.push("--skip-clean");
  if (!options.reboot) words.push("--no-reboot");
  return words;
}

/** The job's command line (the module id left out, as `jobs.start` wants it). Carries no secret. */
export const jobLine = (options: RunOptions): string => ["netinstall", "run", ...optionWords(options)].join(" ");

/** The equivalent command for a technician at a shell: passwords come from `PVX_SECRET_*`, so none is shown. */
export const cliLine = (options: RunOptions): string => ["pvx", "issabel", "netinstall", ...optionWords(options), "--yes"].join(" ");

/** Options from the answers of the conversation (`astver`, `addpkgs`, `timezone`). */
export function optionsFromAnswers(answers: Record<string, string | boolean | undefined>): RunOptions {
  const addons = String(answers.addpkgs ?? "").split(",").filter(isAddonKey);
  const astver = String(answers.astver ?? "");
  return {
    ...DEFAULT_OPTIONS,
    astver: isAsteriskVersion(astver) ? astver : DEFAULT_OPTIONS.astver,
    addpkgs: addons,
    timezone: String(answers.timezone || DEFAULT_OPTIONS.timezone),
  };
}
