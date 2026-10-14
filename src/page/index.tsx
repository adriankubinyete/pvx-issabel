/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// The Issabel tab: the hub, and the tool it opens. Only `sdk.ui`: no React import.
// Opening the tab while an install runs lands straight on its live view.
import type { Sdk } from "@pvx/sdk";
import { JOB_NAME } from "../state.ts";
import { makeHub, type ToolId } from "./Hub.tsx";
import { makeNetinstall } from "./Netinstall.tsx";

export function issabelPage(sdk: Sdk) {
  const { h, useState, useEffect, useJob, useBack } = sdk.ui;
  const Hub = makeHub(sdk.ui);
  const Netinstall = makeNetinstall(sdk.ui);

  function Issabel() {
    const [tool, setTool] = useState<ToolId | undefined>(undefined);
    const job = useJob(JOB_NAME);
    const installing = job.status.state === "running";
    useEffect(() => {
      if (installing) setTool((open) => open ?? "netinstall");
    }, [installing]);
    useBack(tool ? () => setTool(undefined) : undefined);

    if (tool === "netinstall") return <Netinstall onExit={() => setTool(undefined)} />;
    return <Hub onOpen={setTool} />;
  }

  return () => <Issabel />;
}
