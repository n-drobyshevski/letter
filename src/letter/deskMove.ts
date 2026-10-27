/**
 * A sheet pushed around the desk with the mouse (DeskStack, ReadingStack): it slides
 * with the hand and, taken off its centre, turns a little the way the pull twists it,
 * as paper does under a fingertip. It stays where it is let go (paper has friction).
 * Pure, so it can be tested in node.
 */

/** Where the sheet lies on the desk, relative to its home: px, and radians. */
export type Placement = { x: number; y: number; rot: number };
export const HOME: Placement = { x: 0, y: 0, rot: 0 };

/** How far it may wander: a fraction of the sheet's size, and the most it turns (~7°). */
export const PLACE_LIMIT = { x: 0.3, y: 0.2, rot: 0.12 };

const clamp = (v: number, lim: number) => {
  'worklet';
  return Math.max(-lim, Math.min(lim, v));
};

/**
 * The placement after dragging by `d` from `start`, the sheet taken at `grab`
 * (px from its centre). Off-centre pulls turn it: the torque of the drag about the
 * centre, against the sheet's size (taken by the corner, a pull turns it most).
 */
export function dragPlacement(
  start: Placement,
  grab: { x: number; y: number },
  d: { x: number; y: number },
  size: { width: number; height: number },
): Placement {
  'worklet';
  const reach = (size.width * size.width + size.height * size.height) / 4;
  const torque = (grab.x * d.y - grab.y * d.x) / reach;
  return {
    x: clamp(start.x + d.x, size.width * PLACE_LIMIT.x),
    y: clamp(start.y + d.y, size.height * PLACE_LIMIT.y),
    rot: clamp(start.rot + torque * 0.6, PLACE_LIMIT.rot),
  };
}
