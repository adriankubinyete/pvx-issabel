import type { PhaseId } from "../state.ts";
import type { Phase } from "../runner.ts";
import { addonPackages, basePackages, PACKAGES_ISSABEL } from "../packages.ts";
import { attempt, installOrFail, SHORT_TIMEOUT_MS, type PhaseContext } from "./context.ts";

const cleanMetadata = (context: PhaseContext) =>
  attempt(context, "dnf clean all", () => context.shell.ok("dnf", ["clean", "all"], { timeoutMs: SHORT_TIMEOUT_MS }));

export const packagesPhase: Phase<PhaseContext, PhaseId> = {
  id: "packages",
  label: "pacotes",
  async run(context) {
    const { astver, addpkgs, skipClean } = context.options;
    if (!skipClean) await cleanMetadata(context);
    await installOrFail(context, basePackages(astver));
    await installOrFail(context, [...PACKAGES_ISSABEL, ...addonPackages(addpkgs)]);
  },
};
