/**
 * Hardware-independent work counters for `scripts/perf-desk.mjs`: how many pictures were
 * recorded, layouts run, images baked, components rendered. Off (a no-op) unless the page
 * was opened with `?perf=1` on the web; the harness reads `window.__perfCounters`.
 */
type Counters = Record<string, number>;

const on =
  typeof window !== 'undefined' && typeof window.location?.search === 'string' && /[?&]perf=1\b/.test(window.location.search);

const counters: Counters = {};
if (on) (globalThis as { __perfCounters?: Counters }).__perfCounters = counters;

/** Counts one unit of `name` (a picture recorded, a layout run, a render). */
export function perfCount(name: string) {
  if (on) counters[name] = (counters[name] ?? 0) + 1;
}
