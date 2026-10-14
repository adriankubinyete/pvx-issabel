// pvx module `issabel`: the Issabel hub tab and, first, `netinstall` (Issabel 5 from scratch on Rocky/RHEL 8+).
// The factory only builds the object: every effect happens inside run(), prove(), a query or the page.
import type { ModuleFactory } from "@pvx/sdk";
import { installedCapability } from "./capability.ts";
import { createCommands } from "./commands.ts";
import { createQueries } from "./queries.ts";
import type { SystemOverrides } from "./system.ts";
import { issabelPage } from "./ui/page.tsx";

const HUB_TAB_ORDER = 40;

/** `overrides` is how the tests give the module a fake machine. Production uses `makeFactory()` with none. */
export const makeFactory = (overrides: SystemOverrides = {}): ModuleFactory => (sdk) => ({
  commands: createCommands(overrides),
  capabilities: [installedCapability(sdk.proof)],
  queries: createQueries(overrides),
  pages: { issabel: { title: "Issabel", render: issabelPage(sdk), tab: { label: "Issabel", order: HUB_TAB_ORDER } } },
});

export default makeFactory();
