import { addonPackages, basePackages, PACKAGES_ISSABEL } from "../packages.ts";
import { attempt, installOrFail, SHORT_TIMEOUT_MS, type PhaseContext, type InstallPhase } from "./context.ts";

const cleanMetadata = (context: PhaseContext) =>
  attempt(context, "dnf clean all", () => context.shell.ok("dnf", ["clean", "all"], { timeoutMs: SHORT_TIMEOUT_MS }));

export const packagesPhase: InstallPhase = {
  id: "packages",
  label: "pacotes",
  weight: 70,
  async run(context) {
    const { astver, addpkgs, skipClean } = context.options;
    if (!skipClean) await cleanMetadata(context);
    await installOrFail(context, basePackages(astver));
    await installOrFail(context, [...PACKAGES_ISSABEL, ...addonPackages(addpkgs)]);
  },
};
