// What went wrong, in words for the failed screen. Pure.
import type { FailureInfo, PhaseId } from "./state.ts";
import { messageOf } from "./errors.ts";
import { StepError } from "./exec.ts";

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

/** A thrown error as the failure record the page shows. */
export function failureOf(phase: PhaseId, error: unknown): FailureInfo {
  if (error instanceof StepError) return { phase, command: error.command, code: error.code, output: error.output, cause: likelyCause([...error.output, error.message]) };
  return { phase, command: messageOf(error), output: [], cause: DEFAULT_CAUSE };
}
