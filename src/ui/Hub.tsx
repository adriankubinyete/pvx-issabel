/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// The Issabel tab: an index of the module's tools, with the state of the central above. Only netinstall is there today.
import type { ListItem, SdkUi } from "@pvx/sdk";
import { QUERY_CENTRAL, type Central } from "../queries.ts";

export type ToolId = "netinstall" | "backups" | "health";

interface Tool {
  id: ToolId;
  name: string;
  description: string;
  note: string;
  available: boolean;
}

export const TOOLS: Tool[] = [
  { id: "netinstall", name: "netinstall", description: "instalar o Issabel 5 nesta central", note: "~20 min · reinicia", available: true },
  { id: "backups", name: "backups", description: "copiar e restaurar configurações e gravações", note: "em breve", available: false },
  { id: "health", name: "saúde", description: "verificar serviços, troncos e espaço", note: "em breve", available: false },
];

const isToolId = (id: string): id is ToolId => TOOLS.some((tool) => tool.id === id);

const COMING_SOON = "ainda não existe: em breve";

const itemOf = (tool: Tool): ListItem => ({
  id: tool.id,
  cells: {
    name: { text: tool.name, tone: tool.available ? "accent" : "dim" },
    description: { text: tool.description, tone: tool.available ? "text" : "dim" },
    note: { text: tool.note, tone: "dim" },
  },
});

export interface HubProps {
  onOpen: (tool: ToolId) => void;
}

export const makeHub = (ui: SdkUi) => {
  const { h, Panel, Text, List, Loading, useState, useKey, useNudge, usePanels, usePageFocused, useQuery } = ui;

  function HubKeys({ onMove, onOpen }: { onMove: (delta: number) => void; onOpen: () => void }) {
    useKey("↑", "ferramenta", () => onMove(-1), { help: true });
    useKey("↓", "ferramenta", () => onMove(1), { help: true });
    useKey("enter", "abrir", onOpen);
    return null;
  }

  function CentralLine({ central }: { central: Central }) {
    return (
      <Text tone="dim">{`${central.hostname} · ${central.system}    Issabel: ${central.installed ? "instalado" : "não instalado"}`}</Text>
    );
  }

  return function Hub({ onOpen }: HubProps) {
    const panels = usePanels();
    const nudge = useNudge();
    const focused = usePageFocused();
    const central = useQuery<Central>(QUERY_CENTRAL);
    const [selected, setSelected] = useState<ToolId>("netinstall");

    const open = (id: ToolId) => {
      if (TOOLS.find((tool) => tool.id === id)?.available) onOpen(id);
      else nudge(COMING_SOON);
    };
    /** ↑ on the first tool goes to the tab bar; ↓ on the last wraps (UI.md §4). */
    const move = (delta: number) => {
      const index = TOOLS.findIndex((tool) => tool.id === selected);
      if (index === 0 && delta < 0) return panels.toBar();
      setSelected(TOOLS[panels.wrap(index, delta, TOOLS.length)]!.id);
    };

    return (
      <Panel>
        <HubKeys onMove={move} onOpen={() => open(selected)} />
        {central.data ? <CentralLine central={central.data} /> : <Loading label="lendo o estado da central…" />}
        <Text tone="dim"> </Text>
        <Text tone="dim">ferramentas</Text>
        <List
          selected={focused ? selected : undefined}
          items={TOOLS.map(itemOf)}
          columns={[
            { id: "name", width: 14 },
            { id: "description", grow: 1 },
            { id: "note", width: 20 },
          ]}
          onPress={(id) => {
            if (!isToolId(id)) return;
            setSelected(id);
            open(id);
          }}
          onHover={(id) => {
            if (id && focused && isToolId(id)) setSelected(id);
          }}
        />
      </Panel>
    );
  };
};
