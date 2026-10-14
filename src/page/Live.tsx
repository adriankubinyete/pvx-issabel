/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// The install while it runs, and where it stopped: the global bar on top, the phases and the last log lines on the left, what is
// being installed now and the package wall on the right (or, after a failure, the error and the way to continue).
import type { PackageProgress, PhasesState, RunningPackage, RunState, RunView, SdkUi } from "@pvx/sdk";
import { causeOf, commandOf, phaseLabelOf } from "../failure.ts";
import { EXPECTED_INSTALL_MS } from "../state.ts";
import { fit } from "./layout.ts";
import { cellsOf, packageDetail, packageTitle, PACKAGE_PHASE_WORD, runningLabelOf, withPackageCount } from "./rows.ts";

const MAX_RUNNING_ROWS = 3;
/** Columns the right panel loses to its border and the page frame. */
const RIGHT_PANEL_MARGIN = 11;

const BAR_STATE: Record<RunView, "running" | "failed" | "done"> = { idle: "running", running: "running", stale: "running", failed: "failed", done: "done" };

export interface LiveProps {
  /** The run: its job log, its steps and the bar. `failed` also covers a job the technician stopped. */
  run: RunState;
  state: PhasesState;
  packages: PackageProgress;
  onStop: () => void;
  onResume: () => void;
  onNew: () => void;
  onExit: () => void;
}

function rightTitle(showLog: boolean, failed: boolean): string {
  if (showLog) return "log";
  return failed ? "parou" : "pacotes";
}

/** `▸ name version  stage`: the stage always shows; the version goes first when the row is narrow, then the name is cut. */
function runningRow(pkg: RunningPackage, width: number): string {
  const stage = PACKAGE_PHASE_WORD[pkg.phase];
  const withVersion = `▸ ${packageTitle(pkg)}  ${stage}`;
  if (withVersion.length <= width) return withVersion;
  return `${fit(`▸ ${pkg.name}`, width - stage.length - 2)}  ${stage}`;
}

export const makeLive = (ui: SdkUi) => {
  const { h, Fragment, Panel, Row: Side, Text, Notice, Steps, LogTail, ProgressBar, CellGrid, Button, Loading, useState, useKey, useBack, useCopy, useViewport } = ui;

  function LogKey({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
    useKey("l", shown ? "volta ao muro" : "log completo", onToggle);
    return null;
  }

  function StopKey({ onStop }: { onStop: () => void }) {
    useKey("x", "parar", onStop);
    return null;
  }

  function ErrorKey({ onCopy }: { onCopy: () => void }) {
    useKey("c", "copiar erro", onCopy);
    return null;
  }

  function NewKey({ onNew }: { onNew: () => void }) {
    useKey("n", "nova instalação", onNew);
    return null;
  }

  function Running({ state, packages, width, selected, onSelect }: { state: PhasesState; packages: PackageProgress; width: number; selected?: string; onSelect: (id: string) => void }) {
    const detail = selected ? packageDetail(packages, selected) : undefined;
    return (
      <>
        <Loading label="agora" />
        {packages.running.length
          ? packages.running.slice(0, MAX_RUNNING_ROWS).map((pkg) => <Text key={pkg.name} tone="info">{runningRow(pkg, width)}</Text>)
          : <Text tone="info">{`▸ ${runningLabelOf(state)}`}</Text>}
        {packages.total > 0 ? <CellGrid cells={cellsOf(packages)} onPress={onSelect} focused /> : null}
        {detail ? <Text tone="dim">{detail}</Text> : null}
      </>
    );
  }

  function Failure({ state, stopped, width, onResume }: { state: PhasesState; stopped: boolean; width: number; onResume: () => void }) {
    const { failure } = state;
    if (!failure) {
      return (
        <>
          {stopped ? <Notice level="warn">instalação parada</Notice> : <Notice level="error">a instalação parou sem dizer o motivo</Notice>}
          <Text tone="dim">{fit("as fases concluídas não se repetem", width)}</Text>
          <Button label="continuar daqui" primary keys="enter" onPress={onResume} />
        </>
      );
    }
    return (
      <>
        <Notice level="error">{fit(`${phaseLabelOf(state, failure.phase)} falhou`, width)}</Notice>
        <Text tone="dim">{fit(`comando  ${commandOf(failure)}`, width)}</Text>
        {failure.code === undefined ? null : <Text tone="dim">{`saída    código ${failure.code}`}</Text>}
        {(failure.output ?? []).map((line, index) => <Text key={index} tone="dim">{fit(`│ ${line}`, width)}</Text>)}
        <Text tone="dim">causa provável</Text>
        <Text>{fit(causeOf(failure), width * 2)}</Text>
        <Button label="continuar daqui" primary keys="enter" onPress={onResume} />
      </>
    );
  }

  interface RightBodyProps {
    showLog: boolean;
    failed: boolean;
    stopped: boolean;
    state: PhasesState;
    packages: PackageProgress;
    lines: string[];
    width: number;
    selected?: string;
    onSelect: (id: string) => void;
    onResume: () => void;
  }

  /** The log if asked for (it takes the keyboard to scroll), else the error after a stop, else what is installing. */
  function RightBody({ showLog, failed, stopped, state, packages, lines, width, selected, onSelect, onResume }: RightBodyProps) {
    if (showLog) return <LogTail lines={lines} focused />;
    if (failed) return <Failure state={state} stopped={stopped} width={width} onResume={onResume} />;
    return <Running state={state} packages={packages} width={width} selected={selected} onSelect={onSelect} />;
  }

  return function Live({ run, state, packages, onStop, onResume, onNew, onExit }: LiveProps) {
    const { cols } = useViewport();
    const copy = useCopy();
    const [showLog, setShowLog] = useState(false);
    const [selected, setSelected] = useState<string | undefined>(undefined);
    useBack(onExit);
    const width = Math.max(20, Math.floor(cols / 2) - RIGHT_PANEL_MARGIN);
    const failed = run.view === "failed";
    const { failure } = state;
    const copyError = () => void copy(failure ? [commandOf(failure), ...(failure.output ?? [])].join("\n") : "", { title: "erro" });

    return (
      <Panel>
        <LogKey shown={showLog} onToggle={() => setShowLog(!showLog)} />
        {failed ? <NewKey onNew={onNew} /> : <StopKey onStop={onStop} />}
        {failed && failure ? <ErrorKey onCopy={copyError} /> : null}
        <ProgressBar value={run.progress} startedAt={state.startedAt} etaMs={EXPECTED_INSTALL_MS} state={BAR_STATE[run.view]} />
        <Side>
          <Panel title="fases" grow>
            <Steps items={withPackageCount(run.steps, packages)} />
            <LogTail lines={run.lines} />
          </Panel>
          <Panel title={rightTitle(showLog, failed)} tone={failed && !showLog ? "error" : "accent"} grow>
            <RightBody showLog={showLog} failed={failed} stopped={run.status.state === "stopped"} state={state} packages={packages} lines={run.lines} width={width} selected={selected} onSelect={setSelected} onResume={onResume} />
          </Panel>
        </Side>
      </Panel>
    );
  };
};
