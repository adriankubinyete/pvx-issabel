import { MINUTE_MS, type InstallPhase } from "./context.ts";

const INSTALL_AMP = "/usr/src/issabelPBX/framework/install_amp";

export const databasePhase: InstallPhase = {
  id: "database",
  label: "banco do IssabelPBX",
  weight: 6,
  async run(context) {
    await context.shell.must(INSTALL_AMP, ["--dbuser=root", "--installdb", "--scripted", "--language=en"], { timeoutMs: 10 * MINUTE_MS });
  },
};
