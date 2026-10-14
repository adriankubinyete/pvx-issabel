// Output shaped like `dnf install` on Rocky 8 (dnf 4), built from a list of packages. Used by the parser tests and the fake system.
export interface SamplePackage {
  name: string;
  version: string;
  repo?: string;
}

const pad = (text: string, width: number) => text.padEnd(width);
const nevra = (pkg: SamplePackage) => `${pkg.name}-${pkg.version}.x86_64`;

export function dnfTableLines(packages: SamplePackage[]): string[] {
  const rows = packages.map((pkg) => (pkg.name.length > 40 ? [` ${pkg.name}`, `${" ".repeat(29)}x86_64       ${pad(pkg.version, 22)} ${pad(pkg.repo ?? "baseos", 12)} 120 k`] : [` ${pad(pkg.name, 28)} x86_64       ${pad(pkg.version, 22)} ${pad(pkg.repo ?? "baseos", 12)} 120 k`]));
  return [
    "Last metadata expiration check: 0:00:12 ago on Wed 14 Oct 2026 15:02:11.",
    "Dependencies resolved.",
    "=".repeat(80),
    " Package                      Architecture Version                Repository   Size",
    "=".repeat(80),
    "Installing:",
    ...rows.flat(),
    "Enabling module streams:",
    " php                                       remi-7.4",
    "",
    "Transaction Summary",
    "=".repeat(80),
    `Install  ${packages.length} Packages`,
    "",
    "Total download size: 12 M",
    "Installed size: 40 M",
    "Downloading Packages:",
  ];
}

export function dnfTransactionLines(packages: SamplePackage[], opts: { downloadRedraws?: boolean } = {}): string[] {
  const total = packages.length;
  const downloads = packages.flatMap((pkg, i) => [
    ...(opts.downloadRedraws ? [`(${i + 1}/${total}): ${nevra(pkg)}.rpm  45% [=====      ] 1.1 MB/s | 90 kB  00:01 ETA`] : []),
    `(${i + 1}/${total}): ${nevra(pkg)}.rpm          1.1 MB/s | 120 kB     00:00`,
  ]);
  const installs = packages.flatMap((pkg, i) => [`  Installing       : ${nevra(pkg)}                    ${i + 1}/${total}`, `  Running scriptlet: ${nevra(pkg)}                    ${i + 1}/${total}`]);
  const verifies = packages.map((pkg, i) => `  Verifying        : ${nevra(pkg)}                    ${i + 1}/${total}`);
  return [
    ...downloads,
    "-".repeat(80),
    "Total                                           1.8 MB/s |  12 MB     00:06",
    "Running transaction check",
    "Transaction check succeeded.",
    "Running transaction test",
    "Transaction test succeeded.",
    "Running transaction",
    "  Preparing        :                                                        1/1",
    ...installs,
    ...verifies,
    "",
    "Installed:",
    ...packages.map((pkg) => `  ${nevra(pkg)}`),
    "",
    "Complete!",
  ];
}

export const dnfSuccessLines = (packages: SamplePackage[]): string[] => [...dnfTableLines(packages), ...dnfTransactionLines(packages)];

export const SAMPLE_PACKAGES: SamplePackage[] = [
  { name: "libevent", version: "2.1.8-5.el8" },
  { name: "tmux", version: "2.7-1.el8" },
  { name: "htop", version: "3.2.1-1.el8", repo: "epel" },
  { name: "some-extremely-long-package-name-that-wraps-around", version: "1.0.0-1.el8", repo: "appstream" },
];
