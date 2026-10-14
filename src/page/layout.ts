// Small text helpers the screens share. Pure.
export const MASK = "●".repeat(12);

/** `m:ss`, the way the bar and the steps write times. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const pad2 = (value: number) => String(value).padStart(2, "0");
export const timeOfDay = (ms: number): string => `${pad2(new Date(ms).getHours())}:${pad2(new Date(ms).getMinutes())}`;
export const dateTime = (ms: number): string => {
  const date = new Date(ms);
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} ${timeOfDay(ms)}`;
};

/** Cuts `text` to `max` cells with a closing `…`. */
export const fit = (text: string, max: number): string => (text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text);
