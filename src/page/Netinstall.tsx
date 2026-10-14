/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// netinstall, start to end: verification, questions, the install running, where it failed, and the end. What is on screen
// follows the job the host knows (so reopening the page during an install lands on the live view), not a flag kept here.
import type { PackageProgress, RunState, SdkUi } from "@pvx/sdk";
import { messageOf } from "../errors.ts";
import { JOB_NAME, type RunOptions } from "../state.ts";
import { jobLine } from "../options.ts";
import { QUERY_CENTRAL, QUERY_INSTALL, type Central, type InstallView } from "../health/queries.ts";
import type { Check } from "../preflight.ts";
import { makeAsk, type Passwords } from "./Ask.tsx";
import { makeDone } from "./Done.tsx";
import { makeLive } from "./Live.tsx";
import { isInstalled } from "./outcome.ts";
import { makeVerify } from "./Verify.tsx";

const INSTALL_REFRESH_MS = 1000;
const TICK_MS = 1000;
const RESUME_LINE = "netinstall run --resume";
const EMPTY_PACKAGES: PackageProgress = { total: 0, done: [], running: [], failed: [] };

/** `auto`: whatever the job says. The others are the flow the technician walks to start a new install. */
type Stage = { name: "auto" } | { name: "verify"; force: boolean } | { name: "ask"; force: boolean; checks: Check[] } | { name: "starting" } | { name: "error"; message: string };

const AUTO: Stage = { name: "auto" };

/** The install is over (the restart aside) and nothing failed: the done screen. */
const isDone = (run: RunState): boolean => Boolean(run.state && !run.state.failure && isInstalled(run.state));

export interface NetinstallProps {
  onExit: () => void;
}

export const makeNetinstall = (ui: SdkUi) => {
  const { h, Fragment, Notice, Loading, useState, useEffect, useQuery, useRun, useBack } = ui;
  const Verify = makeVerify(ui);
  const Ask = makeAsk(ui);
  const Live = makeLive(ui);
  const Done = makeDone(ui);

  /** Renders the page each second, so the times of the phases (worked out at each render) advance. */
  function useTick(): void {
    const [, setTick] = useState(0);
    useEffect(() => {
      const timer = setInterval(() => setTick((tick) => tick + 1), TICK_MS);
      return () => clearInterval(timer);
    }, []);
  }

  return function Netinstall({ onExit }: NetinstallProps) {
    const run = useRun(JOB_NAME);
    const install = useQuery<InstallView>(QUERY_INSTALL, [], { refreshMs: INSTALL_REFRESH_MS });
    const central = useQuery<Central>(QUERY_CENTRAL);
    const [stage, setStage] = useState<Stage>(AUTO);
    useTick();
    useBack(stage.name === "auto" ? onExit : undefined);

    const jobState = run.status.state;
    useEffect(() => {
      if (stage.name === "starting" && (jobState === "running" || jobState === "failed")) setStage(AUTO);
    }, [stage.name, jobState]);

    const startInstall = async (options: RunOptions, passwords: Passwords) => {
      setStage({ name: "starting" });
      try {
        await run.start(jobLine(options), { secrets: { "sql-password": passwords.sql, "web-password": passwords.web } });
      } catch (error) {
        setStage({ name: "error", message: messageOf(error) });
      }
    };
    const resumeInstall = async () => {
      try {
        await run.start(RESUME_LINE);
      } catch (error) {
        setStage({ name: "error", message: messageOf(error) });
      }
    };
    const stopInstall = () => void run.stop().catch((error: unknown) => setStage({ name: "error", message: messageOf(error) }));
    const toVerify = (force: boolean) => setStage({ name: "verify", force });

    /** Leaving a flow goes back to the run it was started over, or out of netinstall when there is none. */
    const leaveFlow = () => (run.current ? setStage(AUTO) : onExit());
    const flow: Stage = stage.name === "auto" && !run.current && jobState !== "running" ? { name: "verify", force: false } : stage;

    switch (flow.name) {
      case "error":
        return <Notice level="error">{flow.message}</Notice>;
      case "starting":
        return <Loading label="iniciando a instalação…" />;
      case "verify":
        // Keyed by `force`: asking again over an earlier install must start the checks over, not reuse the failed pass.
        return h(Fragment, { key: String(flow.force) }, <Verify force={flow.force} onPassed={(checks) => setStage({ name: "ask", force: flow.force, checks })} onForce={() => toVerify(true)} onExit={leaveFlow} />);
      case "ask":
        return <Ask checks={flow.checks} force={flow.force} onStart={(options, passwords) => void startInstall(options, passwords)} onCancel={leaveFlow} />;
      case "auto":
        break;
    }
    if (!run.current || !run.state) return <Loading label="iniciando a instalação…" />;
    if (!install.data?.install) return <Loading label="lendo o estado da instalação…" />;
    const { packages = EMPTY_PACKAGES, reboot } = install.data;
    if (isDone(run)) return <Done state={run.state} install={install.data.install} packages={packages} reboot={reboot} hostname={central.data?.hostname ?? "—"} onExit={onExit} onNew={() => toVerify(false)} />;
    return <Live run={run} state={run.state} packages={packages} onStop={stopInstall} onResume={() => void resumeInstall()} onNew={() => toVerify(false)} onExit={onExit} />;
  };
};
