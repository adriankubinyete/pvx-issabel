// The seam between the module and the machine it runs on. In production every field is left out and the module uses what the host
// hands it (`ctx.exec`, `ctx.fs`, the real uid). The tests build the module with fakes here, so a test run (or a job process
// started by one) can never reach the real system.
import type { ModuleFs, ReadCtx } from "@pvx/sdk";
import type { InstallPaths } from "./phases/context.ts";
import { installPaths } from "./paths.ts";
import type { ExecFn } from "./exec.ts";
import { sleep } from "./clock.ts";

export interface SystemOverrides {
  exec?: ExecFn;
  fs?: ModuleFs;
  isRoot?: () => boolean;
  paths?: InstallPaths;
  sleep?: (ms: number) => Promise<void>;
}

export const realIsRoot = (): boolean => process.getuid?.() === 0;

export interface SystemParts {
  exec: ExecFn;
  fs: ModuleFs;
  isRoot: () => boolean;
  paths: InstallPaths;
  sleep: (ms: number) => Promise<void>;
}

/** The overrides filled in with what the context provides. */
export const systemOf = (ctx: { exec: ExecFn; fs: ModuleFs }, overrides: SystemOverrides): SystemParts => ({
  exec: overrides.exec ?? ctx.exec,
  fs: overrides.fs ?? ctx.fs,
  isRoot: overrides.isRoot ?? realIsRoot,
  paths: overrides.paths ?? installPaths(),
  sleep: overrides.sleep ?? sleep,
});

/** The read-only side, for queries: `ReadCtx` has no fs writes. */
export const readSystemOf = (ctx: ReadCtx, overrides: SystemOverrides) => ({
  exec: overrides.exec ?? ctx.exec,
  fs: overrides.fs ?? ctx.fs,
  isRoot: overrides.isRoot ?? realIsRoot,
});
