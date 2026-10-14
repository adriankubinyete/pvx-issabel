/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// The checks before an install, one at a time, each with its own spinner. Passing hands the results to the questions; a blocking
// problem stays here with its cause and the way out.
import type { SdkUi, StepItem } from "@pvx/sdk";
import { blockingProblems, CHECK_IDS, CHECK_LABEL, type Check, type CheckId } from "../preflight.ts";
import { QUERY_CHECK } from "../queries.ts";
import { MIRROR_PROBE_URL } from "../packages.ts";

const RUNNING_DETAIL: Partial<Record<CheckId, string>> = { network: `testando ${MIRROR_PROBE_URL.replace("http://", "")}…` };

type StepState = StepItem["state"];
const STATE_BY_LEVEL: Record<Check["level"], StepState> = { ok: "done", warn: "done", error: "failed" };

function detailOf(check: Check): string | undefined {
  if (check.level === "ok") return check.detail;
  return [check.detail, check.message].filter(Boolean).join(" · ");
}

function stepOf(id: CheckId, index: number, results: Check[], current: number): StepItem {
  const result = results[index];
  if (result) return { id, label: CHECK_LABEL[id], state: STATE_BY_LEVEL[result.level], detail: detailOf(result) };
  if (index === current) return { id, label: CHECK_LABEL[id], state: "running", detail: RUNNING_DETAIL[id] };
  return { id, label: CHECK_LABEL[id], state: "pending" };
}

/** Only an earlier install is in the way: `--force` is the way out. */
const blockedByPreviousOnly = (results: Check[]) => results.filter((check) => check.level === "error").every((check) => check.id === "previous");

export interface VerifyProps {
  force: boolean;
  onPassed: (checks: Check[]) => void;
  /** Re-run ignoring an earlier install. */
  onForce: () => void;
  onExit: () => void;
}

/** The checks stop after a failed `root`: nothing else is worth asking. */
const isFinished = (results: Check[]) => results.length >= CHECK_IDS.length || (results.at(-1)?.id === "root" && results.at(-1)?.level === "error");

export const makeVerify = (ui: SdkUi) => {
  const { h, Panel, Text, Steps, useState, useEffect, useQuery, useKey, useBack } = ui;

  function RetryKey({ onRetry }: { onRetry: () => void }) {
    useKey("r", "refazer", onRetry);
    return null;
  }

  function ForceKey({ onForce }: { onForce: () => void }) {
    useKey("f", "instalar mesmo assim", onForce);
    return null;
  }

  /** One pass over the checks. A retry mounts a new one, so no result of the old pass is taken for the new. */
  function VerifyPass({ force, onPassed, onForce, onExit, onRetry }: VerifyProps & { onRetry: () => void; key?: number }) {
    const [results, setResults] = useState<Check[]>([]);
    const finished = isFinished(results);
    const asking = finished ? undefined : CHECK_IDS[results.length];
    const query = useQuery<Check>(QUERY_CHECK, asking ?? results.at(-1)?.id ?? CHECK_IDS[0], force);
    useBack(onExit);

    useEffect(() => {
      if (asking && query.data && query.data.id === asking) setResults([...results, query.data]);
    }, [query.data, asking]);

    const blocking = blockingProblems(results);
    useEffect(() => {
      if (finished && !blocking.length) onPassed(results);
    }, [finished, blocking.length]);

    const stuck = finished && blocking.length > 0;
    return (
      <Panel>
        {stuck ? <RetryKey onRetry={onRetry} /> : null}
        {stuck && blockedByPreviousOnly(results) ? <ForceKey onForce={onForce} /> : null}
        <Steps items={CHECK_IDS.map((id, index) => stepOf(id, index, results, results.length))} />
        {blocking.map((problem) => <Text key={problem} tone="error">{`✗ ${problem}`}</Text>)}
      </Panel>
    );
  }

  return function Verify(props: VerifyProps) {
    const [pass, setPass] = useState(0);
    return <VerifyPass key={pass} {...props} onRetry={() => setPass(pass + 1)} />;
  };
};
