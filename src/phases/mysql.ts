// Talking to the MariaDB root account without a password on argv. SQL goes in on stdin; a password goes in a 0600 file given to
// `--defaults-extra-file` (which must be the first option), removed right after.
import { TEMP_MYSQL_PASSWORD } from "../packages.ts";
import type { ShellResult } from "@pvx/sdk";
import { SECRET_MODE } from "../credentials.ts";
import type { PhaseContext } from "./context.ts";

const SQL_TIMEOUT_MS = 60_000;
const CLIENT_FILE = "mysql-root.cnf";

const clientConfig = (password: string) => `[client]\nuser=root\npassword="${password}"\n`;

/** Runs `sql` as MariaDB root. `password` undefined means the root account has none (or authenticates by socket). */
export async function mysqlAsRoot(context: PhaseContext, sql: string, password?: string): Promise<ShellResult> {
  if (password === undefined) return context.shell.run("mysql", [], { stdin: sql, timeoutMs: SQL_TIMEOUT_MS });
  const file = `${context.paths.stateDir}/${CLIENT_FILE}`;
  await context.fs.write(file, clientConfig(password), { mode: SECRET_MODE });
  try {
    return await context.shell.run("mysql", [`--defaults-extra-file=${file}`], { stdin: sql, timeoutMs: SQL_TIMEOUT_MS });
  } finally {
    await context.fs.remove(file);
  }
}

const setRootPassword = (password: string) => `SET PASSWORD FOR 'root'@'localhost' = PASSWORD('${password}')`;

const stepFailed = (context: PhaseContext, what: string) => context.errors.stepError(what, "mysql", 1, [what]);

/**
 * A new MariaDB lets root in through the unix socket without a password. This sets the temporary password; if it was already
 * set (a rerun), the temporary password must work, and that is enough.
 */
export async function setTemporaryRootPassword(context: PhaseContext): Promise<void> {
  const first = await mysqlAsRoot(context, setRootPassword(TEMP_MYSQL_PASSWORD));
  if (first.code === 0) return;
  const already = await mysqlAsRoot(context, "SELECT 1", TEMP_MYSQL_PASSWORD);
  if (already.code !== 0) throw stepFailed(context, "falha ao definir a senha temporária do MySQL root");
}

/** The IssabelPBX installer and `issabel-admin-passwords` expect an empty root password. A rerun finds it already empty. */
export async function clearRootPassword(context: PhaseContext): Promise<void> {
  const first = await mysqlAsRoot(context, setRootPassword(""), TEMP_MYSQL_PASSWORD);
  if (first.code === 0) return;
  const already = await mysqlAsRoot(context, "SELECT 1");
  if (already.code !== 0) throw stepFailed(context, "falha ao zerar a senha do MySQL root: as fases seguintes dependem dela vazia");
}
