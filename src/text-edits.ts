// Pure edits of the config files the install touches, and readers of the system files it looks at. No fs here: the phases read
// the file, call one of these and write the result back (and skip the write when nothing changed, which keeps a rerun quiet).

export const SELINUX_DISABLED_LINE = "SELINUX=disabled";
export const IPV6_GUARD_LINE = "net.ipv6.conf.all.disable_ipv6 = 1";

const SELINUX_LINE = /^SELINUX=.*/gm;
const PHP_TIMEZONE_LINE = /^;?\s*date\.timezone\s*=.*$/m;

export const withSelinuxDisabled = (content: string): string => content.replace(SELINUX_LINE, SELINUX_DISABLED_LINE);

export function withIpv6Guard(content: string): string {
  if (content.includes(IPV6_GUARD_LINE)) return content;
  const separator = content === "" || content.endsWith("\n") ? "" : "\n";
  return `${content}${separator}${IPV6_GUARD_LINE}\n`;
}

export function withPhpTimezone(content: string, timezone: string): string {
  const line = `date.timezone = ${timezone}`;
  if (PHP_TIMEZONE_LINE.test(content)) return content.replace(PHP_TIMEZONE_LINE, line);
  return `${content.replace(/\n+$/, "")}\n${line}\n`;
}

export const passwdHasUser = (passwd: string, name: string): boolean => passwd.split("\n").some((line) => line.startsWith(`${name}:`));

export type OsRelease = Record<string, string>;

export function parseOsRelease(text: string): OsRelease {
  const entries = text.split("\n").map((line) => line.split("=")).filter(([key]) => Boolean(key));
  return Object.fromEntries(entries.map(([key, ...rest]) => [key!, rest.join("=").replace(/^"|"$/g, "")]));
}

export const isRhelLike = (release: OsRelease): boolean => /rhel|fedora/.test(`${release.ID_LIKE ?? ""} ${release.ID ?? ""}`.toLowerCase());

export function versionMajor(release: OsRelease): number {
  const major = (release.VERSION_ID ?? "0").split(".")[0] ?? "0";
  return /^\d+$/.test(major) ? Number(major) : 0;
}

/** "Rocky Linux 8.10" for the screens. */
export const systemName = (release: OsRelease): string => `${release.NAME ?? release.PRETTY_NAME ?? "Linux"} ${release.VERSION_ID ?? ""}`.trim();

/** RAM plus swap in kB (swap counts: it is what keeps the install from an OOM kill). 0 when unreadable. */
export function memTotalKb(meminfo: string): number {
  const kbOf = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(meminfo)?.[1] ?? 0);
  return kbOf("MemTotal") + kbOf("SwapTotal");
}
