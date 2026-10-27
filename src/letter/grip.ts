/**
 * How a hand takes a sheet to turn it (DeskStack). Pure, so it can be tested in node.
 */

// Most the turn's axis leans off the vertical (rad, ~29°).
export const MAX_TILT = 0.5;

/**
 * How the hand took the sheet: the axis lean (rad) and the drag's direction (unit vector);
 * `spin`, when set, is which way the sheet turns over (else the turn's own direction).
 */
export type Grip = { tilt: number; ux: number; uy: number; spin?: 1 | -1 };

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

/**
 * A loose sheet on the laptop's desk turned over any way (DeskStack, Ctrl + drag): about
 * the axis square to the drag, whichever way it goes. `spin` is which way it turns
 * (1 as a leftward drag turns it, -1 as a rightward one), fixed when the drag starts so
 * a swinging hand never flips the turn round. A vertical drag leans the axis all the
 * way (±π/2): the sheet goes top over bottom and, by the turn's twist, lands upright.
 * `grabY` is 0..1 down the sheet: taken high or low, a sideways turn leans as at an edge.
 */
export function freeGripOf(spin: 1 | -1, tx: number, ty: number, grabY: number): Grip {
  'worklet';
  const len = Math.hypot(tx, ty);
  if (len < 1) return { tilt: 0, ux: -spin, uy: 0, spin };
  const fromDrag = Math.atan2(-spin * ty, Math.abs(tx));
  const fromGrab = spin * (grabY - 0.5) * 0.5 * (Math.abs(tx) / len);
  const tilt = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, fromDrag + fromGrab));
  return { tilt, ux: tx / len, uy: ty / len, spin };
}
