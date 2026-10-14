/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// The questions before an install: only the Asterisk version and the passwords are asked. The extras and the timezone are listed
// in the confirm step (as "(padrão)") and can be edited there. Nothing starts before the [ instalar ] button.
import type { Question, SdkUi } from "@pvx/sdk";
import type { Check } from "../preflight.ts";
import type { RunOptions } from "../state.ts";
import { cliLine, DEFAULT_OPTIONS, optionsFromAnswers, passwordOrGenerated } from "../options.ts";
import { ADDON_KEYS, ADDON_LABEL, DEFAULT_ADDONS } from "../packages.ts";
import { verificationSummary } from "./outcome.ts";

export interface Passwords {
  sql: string;
  web: string;
}

type Answers = Record<string, string | boolean>;

const GENERATE_KEY = "ctrl+g";
const summaryOfPassword = (value: string | boolean) => (value ? "definida" : "gerada");

const ASTERISK_OPTIONS = [
  { value: "18", label: "18", detail: "recomendado" },
  { value: "16", label: "16", detail: "só para centrais que dependem dele" },
];

export const QUESTIONS: Question[] = [
  {
    id: "astver",
    title: "Versão do Asterisk",
    field: {
      id: "astver",
      label: "",
      kind: "choice",
      options: ASTERISK_OPTIONS,
    },
  },
  { id: "sqlPassword", title: "Senha do root do MySQL (em branco: gerar)", field: { id: "sqlPassword", label: "", kind: "secret", generate: GENERATE_KEY }, summary: summaryOfPassword },
  { id: "webPassword", title: "Senha do admin da web (em branco: gerar)", field: { id: "webPassword", label: "", kind: "secret", generate: GENERATE_KEY }, summary: summaryOfPassword },
  {
    id: "addpkgs",
    title: "Pacotes extras",
    skip: true,
    field: { id: "addpkgs", label: "", kind: "multi", options: ADDON_KEYS.map((key) => ({ value: key, label: ADDON_LABEL[key] })) },
  },
  { id: "timezone", title: "Fuso horário", skip: true, field: { id: "timezone", label: "", kind: "line" } },
];

export const INITIAL_ANSWERS: Answers = { astver: DEFAULT_OPTIONS.astver, addpkgs: DEFAULT_ADDONS.join(","), timezone: DEFAULT_OPTIONS.timezone };

export interface AskProps {
  checks: Check[];
  /** `--force`: the install goes ahead over an earlier one. */
  force: boolean;
  onStart: (options: RunOptions, passwords: Passwords) => void;
  onCancel: () => void;
}

export const makeAsk = (ui: SdkUi) => {
  const { h, Fragment, Conversation, Text, Button, useState, useCopy } = ui;

  /** What changes in the central, said plainly: it is the last thing read before [ instalar ]. */
  function BeforeInstalling({ command }: { command: string }) {
    const copy = useCopy();
    return (
      <>
        <Text bold>Antes de instalar</Text>
        <Text tone="warn">▲ a central reinicia sozinha ao terminar</Text>
        <Text tone="warn">▲ o firewalld é desligado (use pvx firewall depois)</Text>
        <Text tone="info">i leva cerca de 20 min e roda em segundo plano: pode fechar o pvx ou cair o SSH</Text>
        <Text tone="dim">{command}</Text>
        <Button label="copiar CLI" keys="c" onPress={() => void copy(command, { title: "comando" })} />
      </>
    );
  }

  return function Ask({ checks, force, onStart, onCancel }: AskProps) {
    const [answers, setAnswers] = useState<Answers>(INITIAL_ANSWERS);
    const optionsOf = (given: Answers): RunOptions => ({ ...optionsFromAnswers(given), force });

    const start = (given: Answers) =>
      onStart(optionsOf(given), { sql: passwordOrGenerated(String(given.sqlPassword ?? "")), web: passwordOrGenerated(String(given.webPassword ?? "")) });

    return (
      <Conversation
        questions={QUESTIONS}
        answers={answers}
        onAnswer={(id, value) => setAnswers((previous) => ({ ...previous, [id]: value }))}
        onConfirm={start}
        onCancel={onCancel}
        confirmLabel="instalar"
        header={<Text tone="dim">{`✓ verificação      ${verificationSummary(checks)}`}</Text>}
        footerSummary={<BeforeInstalling command={cliLine(optionsOf(answers))} />}
      />
    );
  };
};
