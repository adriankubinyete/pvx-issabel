// Keeps the progress in memory and writes it to the module store: at once on a phase change, and at most every
// `MIN_WRITE_GAP_MS` while dnf lines stream in (a store write rewrites a whole JSON file).
import type { Store } from "@pvx/sdk";
import { STORE_KEY, type NetinstallProgress } from "./state.ts";

export const MIN_WRITE_GAP_MS = 500;

export interface ProgressStore {
  readonly progress: NetinstallProgress;
  /** Writes now. */
  save(): void;
  /** Writes if it has been long enough since the last write. */
  touch(): void;
}

export function createProgressStore(store: Store, progress: NetinstallProgress, now: () => number = Date.now): ProgressStore {
  let lastWrite = 0;
  const save = () => {
    store.set(STORE_KEY.progress, progress);
    lastWrite = now();
  };
  return {
    progress,
    save,
    touch: () => {
      if (now() - lastWrite >= MIN_WRITE_GAP_MS) save();
    },
  };
}
