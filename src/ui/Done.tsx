/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// The end: where to open Issabel and with which passwords (hidden until asked), the copy of everything for a ticket, and the
// countdown of the restart that the technician can answer.
import type { SdkUi } from "@pvx/sdk";
import type { Credentials } from "../credentials.ts";
import { QUERY_CREDENTIALS } from "../queries.ts";
import type { NetinstallProgress, RebootPlan } from "../model.ts";
import { addonSummary, dateTime, MASK, rebootStatus, shareText } from "./format.ts";

const TICK_MS = 1000;
const COPY_TITLE = "copiado";
const REBOOT_COMMAND = "issabel netinstall reboot";
const POSTPONE_COMMAND = "issabel netinstall postpone";

export interface DoneProps {
  progress: NetinstallProgress;
  reboot?: RebootPlan;
  hostname: string;
  onExit: () => void;
  onNew: () => void;
}

export const makeDone = (ui: SdkUi) => {
  const { h, Panel, Row: Side, Text, Button, Loading, useState, useEffect, useQuery, useKey, useBack, useCopy, useCommand, useNudge } = ui;

  function useNow(): number {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
      const timer = setInterval(() => setNow(Date.now()), TICK_MS);
      return () => clearInterval(timer);
    }, []);
    return now;
  }

  function Keys({ onReveal, onCopy, onNew, revealed }: { onReveal: () => void; onCopy: () => void; onNew: () => void; revealed: boolean }) {
    useKey("m", revealed ? "ocultar senhas" : "mostrar senhas", onReveal);
    useKey("c", "copiar", onCopy);
    useKey("n", "nova instalação", onNew, { help: true });
    return null;
  }

  function Field({ label, value, tone }: { label: string; value: string; tone?: "dim" | "text" }) {
    return <Text tone={tone}>{`${label.padEnd(14)}${value}`}</Text>;
  }

  return function Done({ progress, reboot, hostname, onExit, onNew }: DoneProps) {
    const now = useNow();
    const copy = useCopy();
    const nudge = useNudge();
    const credentialsQuery = useQuery<Credentials | undefined>(QUERY_CREDENTIALS);
    const reboots = useCommand(REBOOT_COMMAND);
    const postpones = useCommand(POSTPONE_COMMAND);
    const [revealed, setRevealed] = useState(false);
    useBack(onExit);

    const credentials = credentialsQuery.data;
    if (!credentials) return <Loading label="lendo as credenciais…" />;
    const status = rebootStatus(reboot, progress.options.reboot, now);

    const copyEverything = () =>
      void copy(shareText({ hostname, credentials, installedAt: progress.phases.find((phase) => phase.id === "passwords")?.endedAt ?? now, reboot, rebootSkipped: !progress.options.reboot }), { title: COPY_TITLE });
    const answer = async (command: typeof reboots) => {
      const run = await command.run();
      nudge(run.lines.at(-1)?.text);
    };
    const shown = (secret: string) => (revealed ? secret : MASK);

    return (
      <Panel>
        <Keys revealed={revealed} onReveal={() => setRevealed(!revealed)} onCopy={copyEverything} onNew={onNew} />
        <Text tone="ok" bold>{`✓ Issabel 5 instalado   Asterisk ${credentials.asterisk} · ${progress.packages.done.length} pacotes · painel do operador`}</Text>
        <Text tone="dim">{`${dateTime(progress.startedAt)} · extras: ${addonSummary(progress.options.addpkgs)}`}</Text>
        <Text> </Text>
        <Field label="acesso" value={credentials.url ?? "—"} />
        <Field label="usuário web" value={credentials.webUser} />
        <Field label="senha web" value={shown(credentials.webPassword)} />
        <Field label="MySQL root" value={shown(credentials.mysqlPassword)} />
        <Field label="cópia em" value={`${progress.credentialsFile ?? "—"} (0600)`} tone="dim" />
        <Text> </Text>
        {status.canAnswer ? (
          <Side>
            <Text tone={status.tone}>{status.text}</Text>
            <Button label="reiniciar agora" primary keys="enter" onPress={() => void answer(reboots)} />
            <Button label="adiar" keys="a" onPress={() => void answer(postpones)} />
          </Side>
        ) : (
          <Text tone={status.tone}>{status.text}</Text>
        )}
      </Panel>
    );
  };
};
