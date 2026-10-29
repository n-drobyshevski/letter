/**
 * Runs `fn` after `delay` ms, then when the page is idle (requestIdleCallback where there is
 * one, at most `timeout` ms later). Returns a cancel function, for an effect's cleanup.
 */
export function whenIdle(fn: () => void, delay = 0, timeout = 1000): () => void {
  const g = globalThis as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  let idle: number | null = null;
  const timer = setTimeout(() => {
    if (g.requestIdleCallback) idle = g.requestIdleCallback(fn, { timeout });
    else fn();
  }, delay);
  return () => {
    clearTimeout(timer);
    if (idle !== null) g.cancelIdleCallback?.(idle);
  };
}
