import { saveCredentials } from "../credentials.ts";
import type { PhaseId } from "../state.ts";
import type { Phase } from "../runner.ts";
import { attempt, SHORT_TIMEOUT_MS, type PhaseContext } from "./context.ts";

const ADMIN_PASSWORDS = "/usr/bin/issabel-admin-passwords";
const FOP2_MANAGER_SCRIPT = "/usr/local/fop2/create_fop2_manager_user.pl";
const FALLBACK_HOST = "localhost";

/**
 * `--cli init` also runs retrieve_conf, which promotes sip.conf and the other `.confnew` files: a failure here must stop the
 * install. The tool takes the passwords as arguments (it has no other way in), so the logged command hides them.
 */
async function setAdminPasswords(context: PhaseContext): Promise<void> {
  const { sql, web } = context.passwords;
  await context.shell.must(ADMIN_PASSWORDS, ["--cli", "init", sql, web], { display: `${ADMIN_PASSWORDS} --cli init ***`, timeoutMs: SHORT_TIMEOUT_MS });
}

/** `--cli init` never syncs the fop2 manager user, so fop2.cfg keeps the factory AMI password without this. Not fatal. */
async function syncFop2Manager(context: PhaseContext): Promise<void> {
  if (!(await context.fs.exists(FOP2_MANAGER_SCRIPT))) return;
  await attempt(context, "sincronização do usuário AMI do fop2", () => context.shell.ok(FOP2_MANAGER_SCRIPT, [], { timeoutMs: SHORT_TIMEOUT_MS }));
}

async function accessUrl(context: PhaseContext): Promise<string> {
  const result = await context.shell.run("hostname", ["-I"], { buffer: true, timeoutMs: 10_000 });
  const address = result.stdout.trim().split(/\s+/)[0];
  return `https://${address || FALLBACK_HOST}`;
}

/** The credentials file was written when the install started; now it gets the URL. */
async function completeCredentials(context: PhaseContext): Promise<void> {
  const { credentials } = context;
  credentials.data.url = await accessUrl(context);
  await saveCredentials(context.shell, context.fs, credentials.path, credentials.data);
}

export const passwordsPhase: Phase<PhaseContext, PhaseId> = {
  id: "passwords",
  label: "senhas",
  async run(context) {
    await setAdminPasswords(context);
    await syncFop2Manager(context);
    await completeCredentials(context);
  },
};
