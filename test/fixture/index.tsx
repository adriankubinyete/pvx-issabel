// The real module with a fake machine: every exec and fs access of the install and the checks goes to a `fakeSystem`, so a test run
// (and the job process it starts) never reaches the system it runs on. Only the module's own state dir (under the temp PVX_HOME) is
// real, through the host's own `ctx.fs`, so the credentials file and the job files can be inspected.
// Knobs, read from the environment of the test (the job process inherits it):
//   ISSABEL_FAKE_DELAY_MS   slows each fake command down, to watch the install while it runs
//   ISSABEL_FAKE_FAIL_AT    a program that fails with "boom: fake failure" (e.g. install_amp)
//   ISSABEL_FAKE_PRESENT    "1": an Issabel is already on the machine (the `previous` check fails)
import type { CommandCtx, ModuleFactory } from "@pvx/sdk";
import { onFakeMachine } from "@pvx/testing";
import factory from "../../src/index.tsx";
import { stateDir } from "../../src/paths.ts";
import type { Call, Rule } from "../fake.ts";
import { failing, fakeSystem } from "../fake.ts";

// Read per call, not at import: the module is loaded before a test sets its knobs.
const delayMs = () => Number(process.env.ISSABEL_FAKE_DELAY_MS ?? 0);
const failAt = () => process.env.ISSABEL_FAKE_FAIL_AT;
const present = () => process.env.ISSABEL_FAKE_PRESENT === "1";
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Read per call too: each test has its own PVX_HOME.
const isReal = (path: string) => path.startsWith(`${stateDir()}/`);

/** The Mac running the tests is not a central: asterisk is absent (unless asked), the network answers, the memory is plenty. */
const rules: Rule[] = [
  failing((call: Call) => call.cmd === "asterisk" && !present(), { code: 127 }),
  failing((call: Call) => failAt() !== undefined && call.cmd === failAt(), { code: 1, lines: ["boom: fake failure"] }),
];
const system = fakeSystem({ rules, files: { "/proc/meminfo": "MemTotal: 4000000 kB\nSwapTotal: 1000000 kB\n" }, isRoot: true });

const execNow = system.exec;
const slowExec: CommandCtx["exec"] = async (cmd, args = [], opts) => {
  if (delayMs()) await wait(delayMs());
  return execNow(cmd, args, opts);
};
system.exec = slowExec;

const fixture: ModuleFactory = onFakeMachine(factory, system, { real: isReal });
export default fixture;
