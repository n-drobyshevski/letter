/**
 * Sheets pushed around the desk with the mouse (DeskStack, ReadingStack): a sheet
 * slides with the hand and, taken off its centre, turns a little the way the pull
 * twists it, as paper does under a fingertip. It stays where it is let go (paper has
 * friction). On the laptop's desk every sheet of the letter lies out at once, each
 * where it was put; this also finds the sheet under the pointer and places new ones.
 * Pure, so it can be tested in node.
 */

/** Where a sheet lies: its centre's offset from its home (px), and its turn (radians). */
export type Placement = { x: number; y: number; rot: number };
export const HOME: Placement = { x: 0, y: 0, rot: 0 };

/** How far a lone sheet may wander: a fraction of its size; and the most any sheet turns (~7°). */
export const PLACE_LIMIT = { x: 0.3, y: 0.2, rot: 0.12 };

type Size = { width: number; height: number };

const clamp = (v: number, lim: number) => {
  'worklet';
  return Math.max(-lim, Math.min(lim, v));
};

/**
 * The placement after dragging by `d` from `start`, the sheet taken at `grab`
 * (px from its centre). Off-centre pulls turn it: the torque of the drag about the
 * centre, against the sheet's size (taken by the corner, a pull turns it most).
 * `bounds` is how far its centre may go from home (default: PLACE_LIMIT of the sheet).
 */
export function dragPlacement(
  start: Placement,
  grab: { x: number; y: number },
  d: { x: number; y: number },
  size: Size,
  bounds: { x: number; y: number } = { x: size.width * PLACE_LIMIT.x, y: size.height * PLACE_LIMIT.y },
): Placement {
  'worklet';
  const reach = (size.width * size.width + size.height * size.height) / 4;
  const torque = (grab.x * d.y - grab.y * d.x) / reach;
  return {
    x: clamp(start.x + d.x, bounds.x),
    y: clamp(start.y + d.y, bounds.y),
    rot: clamp(start.rot + torque * 0.6, PLACE_LIMIT.rot),
  };
}

/** How far a sheet's centre may go on a desk `area` wide and high: it may hang over the edge a little. */
export function deskBounds(size: Size, area: Size) {
  'worklet';
  return { x: Math.max(0, (area.width - size.width) / 2) + size.width * 0.35, y: Math.max(0, (area.height - size.height) / 2) + size.height * 0.25 };
}

/**
 * The sheet under a point of the desk (px from its top-left), topmost first, or -1.
 * `order` lists sheets bottom to top; each lies at its placement, centred on the desk.
 */
export function sheetAt(point: { x: number; y: number }, placements: Placement[], order: number[], size: Size, area: Size): number {
  'worklet';
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    const pl = placements[i];
    if (!pl) continue;
    const dx = point.x - (area.width / 2 + pl.x);
    const dy = point.y - (area.height / 2 + pl.y);
    // Into the sheet's own frame: undo its turn.
    const c = Math.cos(-pl.rot);
    const s = Math.sin(-pl.rot);
    const lx = dx * c - dy * s;
    const ly = dx * s + dy * c;
    if (Math.abs(lx) <= size.width / 2 && Math.abs(ly) <= size.height / 2) return i;
  }
  return -1;
}

/**
 * Sheets laid out when the desk opens with several already written: fanned out across
 * the desk from left to right, the last one in front, each a little crooked (`tilt(i)`).
 */
export function fanOut(n: number, size: Size, area: Size, tilt: (i: number) => number): Placement[] {
  const span = Math.max(0, area.width - size.width);
  const step = n > 1 ? Math.min(size.width * 0.6, span / (n - 1)) : 0;
  return Array.from({ length: n }, (_, i) => ({
    x: (i - (n - 1) / 2) * step,
    y: (i - (n - 1) / 2) * 10,
    rot: n > 1 ? tilt(i) : 0,
  }));
}

/** A new sheet taken onto the desk: on top of the one in front, a little down and to the right, and crooked. */
export function nextPlacement(front: Placement, size: Size, area: Size, rot: number): Placement {
  const b = deskBounds(size, area);
  return { x: clamp(front.x + 34, b.x), y: clamp(front.y + 22, b.y), rot: clamp(rot, PLACE_LIMIT.rot) };
}
