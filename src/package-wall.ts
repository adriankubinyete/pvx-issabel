// The package progress of the install: `sdk.packages.tracker` reads the dnf output and the wall keeps what it shows in the store,
// for the page and for a resume. A store write rewrites a whole JSON file, so while dnf lines stream in it writes at most every
// `MIN_WRITE_GAP_MS`; the end of a dnf run and a failure write at once.
import type { PackageTracker, Store } from "@pvx/sdk";
import { STORE_KEY } from "./state.ts";

export const MIN_WRITE_GAP_MS = 500;

export interface PackageWall {
  /** One line of dnf output. */
  feed(line: string): void;
  /** A dnf run ended. */
  endRun(ok: boolean): void;
  /** A package the output did not name failed. */
  fail(name: string): void;
}

export function createPackageWall(store: Store, tracker: PackageTracker, now: () => number): PackageWall {
  let lastWrite = 0;
  const save = () => {
    store.set(STORE_KEY.packages, tracker.progress);
    lastWrite = now();
  };
  const saveIfDue = () => {
    if (now() - lastWrite >= MIN_WRITE_GAP_MS) save();
  };
  return {
    feed(line) {
      if (tracker.feed(line)) saveIfDue();
    },
    endRun(ok) {
      tracker.endRun(ok);
      save();
    },
    fail(name) {
      tracker.fail(name);
      save();
    },
  };
}
