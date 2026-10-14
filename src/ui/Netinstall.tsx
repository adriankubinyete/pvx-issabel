/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// netinstall, start to end: verification, questions, the install running, where it failed, and the end. What is on screen
// follows the job the host knows (so reopening the page during an install lands on the live view), not a flag kept here.
import type { SdkUi } from "@pvx/sdk";
import { messageOf } from "../errors.ts";
import { JOB_NAME, type NetinstallProgress, type RunOptions } from "../model.ts";
import { jobLine } from "../options.ts";
import { QUERY_CENTRAL, QUERY_PROGRESS, type Central, type ProgressView } from "../queries.ts";
import { isCurrentProgress, viewOf } from "../progress.ts";
import type { Check } from "../preflight.ts";
import { makeAsk, type Passwords } from "./Ask.tsx";
import { makeDone } from "./Done.tsx";
import { makeLive } from "./Live.tsx";
import { makeVerify } from "./Verify.tsx";

const PROGRESS_REFRESH_MS = 1000;
const RESUME_LINE = "netinstall run --resume";

/** `auto`: whatever the job says. The others are the flow the technician walks to start a new install. */
type Stage = { name: "auto" } | { name: "verify"; force: boolean } | { name: "ask"; force: boolean; checks: Check[] } | { name: "starting" } | { name: "error"; message: string };

const AUTO: Stage = { name: "auto" };

/** A progress that belongs to the job the host knows (not a leftover of an older install). */
type CurrentRun = ProgressView & { progress: NetinstallProgress };
const isCurrentRun = (view: ProgressView): view is CurrentRun => isCurrentProgress(view.progress, view.job);

export interface NetinstallProps {
  onExit: () => void;
}

export const makeNetinstall = (ui: SdkUi) => {
  const { h, Fragment, Panel, Text, Loading, useState, useEffect, useQuery, useJob, useBack } = ui;
  const Verify = makeVerify(ui);
  const Ask = makeAsk(ui);
  const Live = makeLive(ui);
  const Done = makeDone(ui);

  return function Netinstall({ onExit }: NetinstallProps) {
    const job = useJob(JOB_NAME);
    const progress = useQuery<ProgressView>(QUERY_PROGRESS, [], { refreshMs: PROGRESS_REFRESH_MS });
    const central = useQuery<Central>(QUERY_CENTRAL);
    const [stage, setStage] = useState<Stage>(AUTO);
    useBack(stage.name === "auto" ? onExit : undefined);

    const jobState = progress.data?.job.state;
    useEffect(() => {
      if (stage.name === "starting" && (jobState === "running" || jobState === "failed")) setStage(AUTO);
    }, [stage.name, jobState]);

    const startInstall = async (options: RunOptions, passwords: Passwords) => {
      setStage({ name: "starting" });
      try {
        await job.start(jobLine(options), { secrets: { "sql-password": passwords.sql, "web-password": passwords.web } });
      } catch (error) {
        setStage({ name: "error", message: messageOf(error) });
      }
    };
    const resumeInstall = async () => {
      try {
        await job.start(RESUME_LINE);
      } catch (error) {
        setStage({ name: "error", message: messageOf(error) });
      }
    };
    const stopInstall = () => void job.stop().catch((error: unknown) => setStage({ name: "error", message: messageOf(error) }));
    const toVerify = (force: boolean) => setStage({ name: "verify", force });

    const run = progress.data;
    const hasRun = Boolean(run && isCurrentRun(run));
    /** Leaving a flow goes back to the run it was started over, or out of netinstall when there is none. */
    const leaveFlow = () => (hasRun ? setStage(AUTO) : onExit());
    const flow: Stage = stage.name === "auto" && run && !isCurrentRun(run) && run.job.state !== "running" ? { name: "verify", force: false } : stage;

    switch (flow.name) {
      case "error":
        return <Panel><Text tone="error">{`✗ ${flow.message}`}</Text></Panel>;
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
    if (!run) return <Loading label="lendo o estado da instalação…" />;
    if (!isCurrentRun(run)) return <Loading label="iniciando a instalação…" />;
    const view = viewOf(run.progress, run.job.state);
    if (view === "done") return <Done progress={run.progress} reboot={run.reboot} hostname={central.data?.hostname ?? "—"} onExit={onExit} onNew={() => toVerify(false)} />;
    return (
      <Live
        progress={run.progress}
        lines={job.lines}
        failed={view === "failed"}
        stopped={run.job.state === "stopped"}
        onStop={stopInstall}
        onResume={() => void resumeInstall()}
        onNew={() => toVerify(false)}
        onExit={onExit}
      />
    );
  };
};
