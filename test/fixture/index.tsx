// The real module with a fake machine: every exec and fs access of the install and the checks goes to a `fakeSystem`, so a test run
// (and the job process it starts) never reaches the system it runs on. Only the module's own state dir (under the temp PVX_HOME) is
// real, so the credentials file and the job files can be inspected.
// Knobs, read from the environment of the test (the job process inherits it):
//   ISSABEL_FAKE_DELAY_MS   slows each fake command down, to watch the install while it runs
//   ISSABEL_FAKE_FAIL_AT    a program that fails with "boom: fake failure" (e.g. install_amp)
//   ISSABEL_FAKE_PRESENT    "1": an Issabel is already on the machine (the `previous` check fails)
import { makeFactory } from "../../src/index.tsx";
import type { Call, Rule } from "../fake.ts";
import { failing, fakeSystem } from "../fake.ts";

// Read per call, not at import: the module is loaded before a test sets its knobs.
const delayMs = () => Number(process.env.ISSABEL_FAKE_DELAY_MS ?? 0);
const failAt = () => process.env.ISSABEL_FAKE_FAIL_AT;
const present = () => process.env.ISSABEL_FAKE_PRESENT === "1";
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const realStateDir = `${process.env.PVX_HOME}/modules/issabel/state`;
const isReal = (path: string) => path.startsWith(`${realStateDir}/`);

/** The Mac running the tests is not a central: asterisk is absent (unless asked), the network answers, the memory is plenty. */
const rules: Rule[] = [
  failing((call: Call) => call.cmd === "asterisk" && !present(), { code: 127 }),
  failing((call: Call) => failAt() !== undefined && call.cmd === failAt(), { code: 1, lines: ["boom: fake failure"] }),
];
const system = fakeSystem({ rules, files: { "/proc/meminfo": "MemTotal: 4000000 kB\nSwapTotal: 1000000 kB\n" } });

/** chmod and mv on a file of the state dir are done for real (and only those, and only there). */
async function realFileCommand(cmd: string, args: string[]) {
  const process_ = Bun.spawn([cmd, ...args], { stdout: "ignore", stderr: "ignore" });
  return { code: await process_.exited, stdout: "", stderr: "" };
}

export default makeFactory({
  exec: async (cmd, args = [], opts) => {
    if (delayMs()) await wait(delayMs());
    if ((cmd === "chmod" || cmd === "mv") && args.some(isReal)) return realFileCommand(cmd, args);
    return system.exec(cmd, args, opts);
  },
  fs: {
    read: (path) => (isReal(path) ? Bun.file(path).text() : system.fs.read(path)),
    exists: (path) => (isReal(path) ? Bun.file(path).exists() : system.fs.exists(path)),
    write: async (path, data) => (isReal(path) ? void (await Bun.write(path, data)) : system.fs.write(path, data)),
    remove: async (path) => (isReal(path) ? void (await Bun.file(path).delete().catch(() => {})) : system.fs.remove(path)),
    list: (path) => system.fs.list(path),
    append: (path, text) => system.fs.append(path, text),
  },
  isRoot: () => true,
  paths: { assets: "/module/assets", stateDir: realStateDir },
  sleep: (ms) => wait(Math.min(ms, 50)),
});
