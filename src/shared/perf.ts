/** Tiny named-mark recorder for the cold-start budget (AC9). Not telemetry: it never leaves the device. */
const marks = new Map<string, number>();
const t0 = Date.now();

export const perf = {
  mark(name: string): void {
    if (!marks.has(name)) {
      marks.set(name, Date.now() - t0);
    }
  },
  get(name: string): number | undefined {
    return marks.get(name);
  },
  all(): Record<string, number> {
    return Object.fromEntries(marks);
  },
};
