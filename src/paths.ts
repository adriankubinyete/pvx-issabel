import { join } from "node:path";
import type { InstallPaths } from "./phases/context.ts";
import { stateDir } from "./secure-file.ts";

/** The module's `assets/` dir, found from this file (the loader imports the module from where it lives). */
export const ASSETS_DIR = join(import.meta.dir, "..", "assets");

export const installPaths = (): InstallPaths => ({ assets: ASSETS_DIR, stateDir: stateDir() });
