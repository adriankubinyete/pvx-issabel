// A file that holds a secret never exists with a wider mode than 0600, not even for an instant: the empty file is created and
// locked down first, and only then does the content go in. `ctx.fs.write` keeps the mode of a file that already exists.
import type { ModuleFs } from "@pvx/sdk";
import type { Shell } from "./exec.ts";

const SECRET_MODE = "600";

export const stateDir = () => `${process.env.PVX_HOME || "/etc/pvx"}/modules/issabel/state`;

/** Writes `content` to `path` with mode 0600. */
export async function writeSecretFile(shell: Shell, fs: ModuleFs, path: string, content: string): Promise<void> {
  await fs.write(path, "");
  await shell.must("chmod", [SECRET_MODE, path]);
  await fs.write(path, content);
}

/** The same, but the final path only ever shows a complete file: written beside it, then renamed over it. */
export async function writeSecretFileAtomically(shell: Shell, fs: ModuleFs, path: string, content: string): Promise<void> {
  const partial = `${path}.partial`;
  await writeSecretFile(shell, fs, partial, content);
  await shell.must("mv", ["-f", partial, path]);
}
