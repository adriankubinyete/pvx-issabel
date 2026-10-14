// Texts the module repeats in several places, so each one is written once.

/** The commands a message points the technician to. */
export const FIX = {
  netinstall: "issabel netinstall",
  resume: "pvx issabel netinstall resume",
  status: "pvx issabel netinstall status",
  follow: "pvx jobs log issabel netinstall -f",
} as const;

export const HOW_TO_FOLLOW = `acompanhe com: ${FIX.follow}`;
export const NO_RUN_TO_RESUME = "não há instalação para continuar: rode `pvx issabel netinstall`";
export const NO_REBOOT_PLAN = "não há reinício agendado";
export const STOPPED = `instalação parada: continue com \`${FIX.resume}\``;
export const STOPPED_FAILED = `a instalação parou: veja \`${FIX.status}\` e continue com \`${FIX.resume}\``;
export const ALREADY_RUNNING = `a instalação já está rodando: ${HOW_TO_FOLLOW}`;
export const MISSING_PASSWORDS = "faltam as senhas: o job as recebe pelo pvx (PVX_SECRET_SQL_PASSWORD e PVX_SECRET_WEB_PASSWORD)";
