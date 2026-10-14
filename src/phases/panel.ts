// The operator panel is always installed (owner decision): the bundled files, then three sqlite inserts that register it in the
// Issabel menu and give group 1 permission. Each insert is guarded by WHERE NOT EXISTS, so a rerun adds nothing twice.
import { join } from "node:path";
import type { PhaseId } from "../state.ts";
import type { Phase } from "../runner.ts";
import { attempt, SHORT_TIMEOUT_MS, type PhaseContext } from "./context.ts";

const PANEL_DIR = "/var/www/html/modules/control_panel";
const ACL_DB = "/var/www/db/acl.db";
const MENU_DB = "/var/www/db/menu.db";

const INSERT_RESOURCE =
  "INSERT INTO acl_resource (name, description) SELECT 'control_panel','Issabel Panel' WHERE NOT EXISTS (SELECT 1 FROM acl_resource WHERE name='control_panel');";
const INSERT_MENU =
  "INSERT INTO menu (id, IdParent, Link, Name, Type, order_no) SELECT 'control_panel','pbxconfig','','Issabel Panel','module',8 WHERE NOT EXISTS (SELECT 1 FROM menu WHERE id='control_panel');";
const INSERT_PERMISSION =
  "INSERT INTO acl_group_permission (id_action, id_group, id_resource) SELECT 1,1,(SELECT id FROM acl_resource WHERE name='control_panel') WHERE NOT EXISTS (SELECT 1 FROM acl_group_permission WHERE id_group=1 AND id_resource=(SELECT id FROM acl_resource WHERE name='control_panel'));";

/** Fresh copy every time: the bundled files are the source of truth. */
async function copyPanelFiles(context: PhaseContext): Promise<void> {
  await context.shell.must("rm", ["-rf", PANEL_DIR]);
  await context.shell.must("cp", ["-R", join(context.paths.assets, "control_panel"), PANEL_DIR], { timeoutMs: SHORT_TIMEOUT_MS });
  await context.shell.must("chown", ["-R", "asterisk:asterisk", PANEL_DIR]);
  await context.shell.must("chmod", ["-R", "755", PANEL_DIR]);
}

/** A failed insert leaves a working Issabel without the panel in its menu: a warning, not a stop. */
async function registerInMenu(context: PhaseContext): Promise<void> {
  const inserts: [string, string][] = [[ACL_DB, INSERT_RESOURCE], [MENU_DB, INSERT_MENU], [ACL_DB, INSERT_PERMISSION]];
  for (const [database, sql] of inserts) await attempt(context, `sqlite3 ${database}`, () => context.shell.ok("sqlite3", [database, sql]));
}

export const panelPhase: Phase<PhaseContext, PhaseId> = {
  id: "panel",
  label: "painel do operador",
  async run(context) {
    await copyPanelFiles(context);
    await registerInMenu(context);
  },
};
