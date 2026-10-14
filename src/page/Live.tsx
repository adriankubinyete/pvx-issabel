/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// The install while it runs, and where it stopped: the global bar on top, the phases and the last log lines on the left, what is
// being installed now and the package wall on the right (or, after a failure, the error and the way to continue).
import type { SdkUi } from "@pvx/sdk";
import { EXPECTED_INSTALL_MS, PHASE_LABEL, type NetinstallProgress, type RunningPackage } from "../state.ts";
import { overallProgress } from "../progress.ts";
import { fit } from "./layout.ts";
import { cellsOf, packageDetail, packageTitle, STAGE_WORD, stepsOf } from "./rows.ts";

const MAX_RUNNING_ROWS = 3;
const TICK_MS = 1000;
/** Columns the right panel loses to its border and the page frame. */
const RIGHT_PANEL_MARGIN = 11;

export interface LiveProps {
  progress: NetinstallProgress;
  /** The job log, whole (the host keeps the tail). */
  lines: string[];
  /** `failed` also covers a job the technician stopped. */
  failed: boolean;
  stopped: boolean;
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
  const stage = STAGE_WORD[pkg.stage];
  const withVersion = `▸ ${packageTitle(pkg)}  ${stage}`;
  if (withVersion.length <= width) return withVersion;
  return `${fit(`▸ ${pkg.name}`, width - stage.length - 2)}  ${stage}`;
}

export const makeLive = (ui: SdkUi) => {
  const { h, Fragment, Panel, Row: Side, Text, Steps, LogTail, ProgressBar, CellGrid, Button, Loading, useState, useEffect, useKey, useBack, useCopy, useViewport } = ui;

  /** A clock that re-renders the screen each second, so the times of the phases advance. */
  function useNow(): number {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
      const timer = setInterval(() => setNow(Date.now()), TICK_MS);
      return () => clearInterval(timer);
    }, []);
    return now;
  }

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

  function Running({ progress, width, selected, onSelect }: { progress: NetinstallProgress; width: number; selected?: string; onSelect: (id: string) => void }) {
    const { packages } = progress;
    const detail = selected ? packageDetail(packages, selected) : undefined;
    const phase = progress.phase ? PHASE_LABEL[progress.phase] : "—";
    return (
      <>
        <Loading label="agora" />
        {packages.running.length
          ? packages.running.slice(0, MAX_RUNNING_ROWS).map((pkg) => <Text key={pkg.name} tone="info">{runningRow(pkg, width)}</Text>)
          : <Text tone="info">{`▸ ${phase}`}</Text>}
        {packages.total > 0 ? <CellGrid cells={cellsOf(packages)} onPress={onSelect} focused /> : null}
        {detail ? <Text tone="dim">{detail}</Text> : null}
      </>
    );
  }

  function Failure({ progress, stopped, width, onResume }: { progress: NetinstallProgress; stopped: boolean; width: number; onResume: () => void }) {
    const { error } = progress;
    if (!error) {
      return (
        <>
          <Text tone="warn" bold>{stopped ? "▲ instalação parada" : "✗ a instalação parou sem dizer o motivo"}</Text>
          <Text tone="dim">{fit("as fases concluídas não se repetem", width)}</Text>
          <Button label="continuar daqui" primary keys="enter" onPress={onResume} />
        </>
      );
    }
    return (
      <>
        <Text tone="error" bold>{fit(`✗ ${PHASE_LABEL[error.phase]} falhou`, width)}</Text>
        <Text tone="dim">{fit(`comando  ${error.command}`, width)}</Text>
        {error.code === undefined ? null : <Text tone="dim">{`saída    código ${error.code}`}</Text>}
        {error.output.map((line, index) => <Text key={index} tone="dim">{fit(`│ ${line}`, width)}</Text>)}
        <Text tone="dim">causa provável</Text>
        <Text>{fit(error.cause, width * 2)}</Text>
        <Button label="continuar daqui" primary keys="enter" onPress={onResume} />
      </>
    );
  }

  interface RightBodyProps {
    showLog: boolean;
    failed: boolean;
    stopped: boolean;
    progress: NetinstallProgress;
    lines: string[];
    width: number;
    selected?: string;
    onSelect: (id: string) => void;
    onResume: () => void;
  }

  /** The log if asked for, else the error after a stop, else what is installing. */
  function RightBody({ showLog, failed, stopped, progress, lines, width, selected, onSelect, onResume }: RightBodyProps) {
    if (showLog) return <LogTail lines={lines} />;
    if (failed) return <Failure progress={progress} stopped={stopped} width={width} onResume={onResume} />;
    return <Running progress={progress} width={width} selected={selected} onSelect={onSelect} />;
  }

  return function Live({ progress, lines, failed, stopped, onStop, onResume, onNew, onExit }: LiveProps) {
    const now = useNow();
    const { cols } = useViewport();
    const copy = useCopy();
    const [showLog, setShowLog] = useState(false);
    const [selected, setSelected] = useState<string | undefined>(undefined);
    useBack(onExit);
    const width = Math.max(20, Math.floor(cols / 2) - RIGHT_PANEL_MARGIN);
    const barState = failed ? "failed" : "running";
    const copyError = () => void copy([progress.error?.command, ...(progress.error?.output ?? [])].filter(Boolean).join("\n"), { title: "erro" });

    return (
      <Panel>
        <LogKey shown={showLog} onToggle={() => setShowLog(!showLog)} />
        {failed ? <NewKey onNew={onNew} /> : <StopKey onStop={onStop} />}
        {failed && progress.error ? <ErrorKey onCopy={copyError} /> : null}
        <ProgressBar value={overallProgress(progress)} startedAt={progress.startedAt} etaMs={EXPECTED_INSTALL_MS} state={barState} />
        <Side>
          <Panel title="fases" grow>
            <Steps items={stepsOf(progress, now)} />
            <LogTail lines={lines} />
          </Panel>
          <Panel title={rightTitle(showLog, failed)} tone={failed && !showLog ? "error" : "accent"} grow>
            <RightBody showLog={showLog} failed={failed} stopped={stopped} progress={progress} lines={lines} width={width} selected={selected} onSelect={setSelected} onResume={onResume} />
          </Panel>
        </Side>
      </Panel>
    );
  };
};
