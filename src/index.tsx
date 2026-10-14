// pvx module `issabel`: the Issabel hub tab and, first, `netinstall` (Issabel 5 from scratch on Rocky/RHEL 8+).
// The factory only builds the object: every effect happens inside run(), prove(), a query or the page.
import type { ModuleFactory } from "@pvx/sdk";
import { installedCapability } from "./health/prove.ts";
import { createCommands } from "./commands/index.ts";
import { queries } from "./health/queries.ts";
import { issabelPage } from "./page/index.tsx";

const HUB_TAB_ORDER = 40;

const factory: ModuleFactory = (sdk) => ({
  commands: createCommands(sdk),
  capabilities: [installedCapability(sdk.proof)],
  queries,
  pages: { issabel: { title: "Issabel", render: issabelPage(sdk), tab: { label: "Issabel", order: HUB_TAB_ORDER } } },
});

export default factory;
