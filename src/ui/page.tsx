/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// The Issabel tab: the hub, and the tool it opens. Only `sdk.ui`: no React import.
// Opening the tab while an install runs lands straight on its live view.
import type { Sdk } from "@pvx/sdk";
import { QUERY_PROGRESS, type ProgressView } from "../queries.ts";
import { makeHub, type ToolId } from "./Hub.tsx";
import { makeNetinstall } from "./Netinstall.tsx";

export function issabelPage(sdk: Sdk) {
  const { h, Loading, useState, useEffect, useQuery, useBack } = sdk.ui;
  const Hub = makeHub(sdk.ui);
  const Netinstall = makeNetinstall(sdk.ui);

  function Issabel() {
    const [tool, setTool] = useState<ToolId | undefined>(undefined);
    const run = useQuery<ProgressView>(QUERY_PROGRESS);
    const installing = run.data?.job.state === "running";
    useEffect(() => {
      if (installing) setTool((open) => open ?? "netinstall");
    }, [installing]);
    useBack(tool ? () => setTool(undefined) : undefined);

    if (!run.data) return <Loading label="lendo o estado da central…" />;
    if (tool === "netinstall") return <Netinstall onExit={() => setTool(undefined)} />;
    return <Hub onOpen={setTool} />;
  }

  return () => <Issabel />;
}
