// What went wrong, in words for the failed screen. Pure.
import type { PhaseFailure, PhasesState } from "@pvx/sdk";

interface CauseRule {
  pattern: RegExp;
  cause: string;
}

/** Likely causes, most specific first. The default points at the log. */
const CAUSES: CauseRule[] = [
  { pattern: /Access denied for user 'root'/i, cause: "a senha do MySQL não foi aplicada na fase anterior" },
  { pattern: /No space left on device/i, cause: "o disco da central encheu: libere espaço e continue" },
  { pattern: /Could not resolve host|Curl error|Failed to download|Cannot download|Failed to synchronize cache|timed out/i, cause: "a central perdeu o acesso à rede ou a um mirror durante a fase: confira a rede e continue" },
  { pattern: /No match for argument|Unable to find a match/i, cause: "um pacote não existe nos repositórios ligados: confira os repositórios e o Remi" },
  { pattern: /GPG|signature|public key/i, cause: "a assinatura de um pacote não confere: confira o repositório de origem" },
  { pattern: /scriptlet|%post|rpm -V/i, cause: "o script de instalação de um pacote falhou: veja o log completo" },
];
export const DEFAULT_CAUSE = "causa desconhecida: veja o log completo com `pvx jobs log issabel netinstall`";

export function likelyCause(output: string[]): string {
  const text = output.join("\n");
  return CAUSES.find((rule) => rule.pattern.test(text))?.cause ?? DEFAULT_CAUSE;
}

/** The likely cause of a recorded failure, from what the command printed and what the error said. */
export const causeOf = (failure: PhaseFailure): string => likelyCause([...(failure.output ?? []), failure.message]);

/** What ran when the phase failed; an error that came from no command shows its message instead. */
export const commandOf = (failure: PhaseFailure): string => failure.command ?? failure.message;

/** The label of a phase by its id (the failure only holds the id). */
export const phaseLabelOf = (state: PhasesState, id: string): string => state.phases.find((phase) => phase.id === id)?.label ?? id;
