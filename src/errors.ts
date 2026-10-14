/** The text of anything that was thrown. */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Anything that was thrown, as an `Error`. */
export const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));
