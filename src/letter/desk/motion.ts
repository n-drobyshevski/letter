/**
 * Drawer and carry motion (spec §3.3, §3.5): worklets and spring configs shared by the fronts'
 * gestures and the carry layer. Pure: no Reanimated import, so node tests can run them.
 */

/** Opening: ζ ≈ 0.84, overshoots 1–2 % (the drawer meeting its stop). Add `velocity` (t per second) at the call. */
export const SPRING_OPEN = { stiffness: 170, damping: 22, mass: 1 } as const;
/** Closing: the same, clamped, like a soft-close. */
export const SPRING_CLOSE = { stiffness: 170, damping: 22, mass: 1, overshootClamping: true } as const;
/** Opening or closing from a tap: no bounce. */
export const SPRING_TAP = { stiffness: 170, damping: 26, mass: 1 } as const;

/** A tap on a front: less movement than this (pt) and shorter than this (ms). */
export const TAP = { maxMove: 6, maxMs: 250 } as const;
/** An item starts being carried past `activate` pt; on touch it rides `offset` pt above the finger. */
export const CARRY = { activate: 8, offset: -56 } as const;

/**
 * Rubber band: `x` (pt) past the limit, resisted. It starts at slope `c` and never reaches `c · d`
 * (5.5 pt for the front's tug at d = 10), whatever the finger does. Odd: a negative `x` pulls the other way.
 */
export function rubber(x: number, d: number, c = 0.55): number {
  'worklet';
  if (d <= 0) return 0;
  const a = Math.abs(x);
  return (Math.sign(x) * c * d * a) / (a + d);
}

/** Where a released drawer settles, 0 (closed) or 1 (open), from its t, the vertical velocity (pt/s) and its travel D. */
export function settleTarget(t: number, vy: number, D: number): 0 | 1 {
  'worklet';
  // Dragging up opens: velocity in t per second is −vy / D; project 0.15 s ahead.
  const v = D > 0 ? -vy / D : 0;
  const projected = t + 0.15 * v;
  if (vy < -600) return 1;
  if (vy <= 600 && projected > 0.45) return 1;
  return 0;
}

/** The camera pan: max(tᵢ · Cᵢ) over the drawers. */
export function liftOf(ts: readonly number[], Cs: readonly number[]): number {
  'worklet';
  let lift = 0;
  const n = Math.min(ts.length, Cs.length);
  for (let i = 0; i < n; i++) lift = Math.max(lift, ts[i] * Cs[i]);
  return lift;
}
