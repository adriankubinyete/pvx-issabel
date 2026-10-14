import { join } from "node:path";
import type { InstallPaths } from "./phases/context.ts";

/** The module's `assets/` dir, found from this file (the loader imports the module from where it lives). */
export const ASSETS_DIR = join(import.meta.dir, "..", "assets");

export const stateDir = () => `${process.env.PVX_HOME || "/etc/pvx"}/modules/issabel/state`;

export const installPaths = (): InstallPaths => ({ assets: ASSETS_DIR, stateDir: stateDir() });
