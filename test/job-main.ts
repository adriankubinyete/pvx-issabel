// Stands in for the `pvx` binary in the job tests: a detached `jobs run` process that loads the usermodules of PVX_USERMODULES.
import { createLogger, createRegistry, loadModules, logsDir, runCli } from "@pvx/core";

const makeLogger = (name: string) => createLogger(logsDir(), name);
const registry = createRegistry();
await loadModules(registry, { hostVersion: "0.1.0", makeLogger });
const exit = await runCli({
  argv: process.argv.slice(2), env: process.env, isTTY: false, isRoot: true, registry, makeLogger, profilesDir: "", version: "test",
  theme: { text: "", accent: "", warn: "", error: "", info: "" }, out: () => {},
});
process.exitCode = exit as number;
