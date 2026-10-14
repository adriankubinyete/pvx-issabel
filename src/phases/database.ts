import type { PhaseId } from "../model.ts";
import type { Phase } from "../runner.ts";
import type { PhaseContext } from "./context.ts";
import { MINUTE_MS } from "./context.ts";

const INSTALL_AMP = "/usr/src/issabelPBX/framework/install_amp";

export const databasePhase: Phase<PhaseContext, PhaseId> = {
  id: "database",
  label: "banco do IssabelPBX",
  async run(context) {
    await context.shell.must(INSTALL_AMP, ["--dbuser=root", "--installdb", "--scripted", "--language=en"], { timeoutMs: 10 * MINUTE_MS });
  },
};
