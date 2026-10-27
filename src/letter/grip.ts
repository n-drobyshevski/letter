/**
 * How a hand takes a sheet to turn it (DeskStack). Pure, so it can be tested in node.
 */

// Most the turn's axis leans off the vertical (rad, ~29°).
export const MAX_TILT = 0.5;

/** How the hand took the sheet: the axis lean (rad) and the drag's direction (unit vector). */
export type Grip = { tilt: number; ux: number; uy: number };

/**
 * The turn's shape from the drag so far: the axis is square to the drag (an upward
 * pull leans it one way, a downward the other), plus a lean from where the edge was
 * taken (near the top, the top corner leads; near the bottom, the bottom one).
 * `dir` 1 drags left from the right edge, -1 right from the left edge; `grabY` is 0..1 down the sheet.
 */
export function gripOf(dir: 1 | -1, tx: number, ty: number, grabY: number): Grip {
  'worklet';
  const along = Math.max(Math.abs(tx), 24);
  const fromDrag = Math.atan2(-dir * ty, along) * 0.8;
  const fromGrab = dir * (grabY - 0.5) * 0.5;
  const tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, fromDrag + fromGrab));
  const len = Math.hypot(tx, ty);
  return len < 1 ? { tilt, ux: -dir, uy: 0 } : { tilt, ux: tx / len, uy: ty / len };
}
