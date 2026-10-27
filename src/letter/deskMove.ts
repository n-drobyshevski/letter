/**
 * Sheets pushed around the desk with the mouse (DeskStack, ReadingStack): a sheet
 * slides with the hand and, taken off its centre, turns a little the way the pull
 * twists it, as paper does under a fingertip. It stays where it is let go (paper has
 * friction). On the laptop's desk every sheet of the letter lies out at once, each
 * where it was put; this also finds the sheet under the pointer and places new ones.
 * A right-button drag turns a sheet round its centre to any angle, and there it stays.
 * Pure, so it can be tested in node.
 */

/**
 * Where a sheet lies: its centre's offset from its home (px), and its turn (radians).
 * `aim` is the angle it was turned to by hand (a right-button drag): it settles back there
 * after a move, where a sheet never turned by hand settles straight.
 */
export type Placement = { x: number; y: number; rot: number; aim?: number };
export const HOME: Placement = { x: 0, y: 0, rot: 0 };

/** How far a lone sheet may wander: a fraction of its size; and the most a pull turns a sheet off its angle (~7°). */
export const PLACE_LIMIT = { x: 0.3, y: 0.2, rot: 0.12 };

type Size = { width: number; height: number };

const clamp = (v: number, lim: number) => {
  'worklet';
  return Math.max(-lim, Math.min(lim, v));
};

/**
 * The placement after dragging by `d` from `start`, the sheet taken at `grab`
 * (px from its centre). Off-centre pulls turn it: the torque of the drag about the
 * centre, against the sheet's size (taken by the corner, a pull turns it most), a few
 * degrees either side of the angle it was turned to by hand.
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
  const aim = start.aim ?? 0;
  const out: Placement = {
    x: clamp(start.x + d.x, bounds.x),
    y: clamp(start.y + d.y, bounds.y),
    rot: aim + clamp(start.rot - aim + torque * 0.6, PLACE_LIMIT.rot),
  };
  if (start.aim !== undefined) out.aim = start.aim;
  return out;
}

/** An angle brought into (-π, π]. */
export function wrapAngle(a: number) {
  'worklet';
  const t = Math.PI * 2;
  const r = ((((a + Math.PI) % t) + t) % t) - Math.PI;
  return r === -Math.PI ? Math.PI : r;
}

/**
 * How far the hand swept round a centre between two points (each given from that centre):
 * the signed angle from `a` to `b` (clockwise on screen is positive, as `rot`). Summed over
 * a drag's steps it follows the hand round and round; next to the centre the angle means
 * nothing, so a point within `dead` px of it sweeps nothing.
 */
export function sweep(a: { x: number; y: number }, b: { x: number; y: number }, dead = 16) {
  'worklet';
  if (Math.hypot(a.x, a.y) < dead || Math.hypot(b.x, b.y) < dead) return 0;
  return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
}

/** A sheet turned by hand (right-button drag) by `by` radians, any angle: it stays there (its aim). */
export function twistPlacement(start: Placement, by: number): Placement {
  'worklet';
  const rot = wrapAngle(start.rot + by);
  return { x: start.x, y: start.y, rot, aim: rot };
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

/** The middle of some sheets' centres (offsets from home), for turning them as one. */
export function groupCentre(placements: Placement[], ids: number[]): { x: number; y: number } {
  'worklet';
  let x = 0;
  let y = 0;
  let n = 0;
  for (const i of ids) {
    const pl = placements[i];
    if (!pl) continue;
    x += pl.x;
    y += pl.y;
    n++;
  }
  return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}

/**
 * Several sheets pushed as one (picked with Shift + click): each from where it lay (`starts`)
 * by the same `d`, none turned, the push held back so none leaves the desk (a sheet already
 * past the edge only can't go further out).
 */
export function moveGroup(starts: Placement[], ids: number[], d: { x: number; y: number }, size: Size, area: Size): Placement[] {
  'worklet';
  const b = deskBounds(size, area);
  let loX = -Infinity;
  let hiX = Infinity;
  let loY = -Infinity;
  let hiY = Infinity;
  for (const i of ids) {
    const pl = starts[i];
    if (!pl) continue;
    loX = Math.max(loX, Math.min(0, -b.x - pl.x));
    hiX = Math.min(hiX, Math.max(0, b.x - pl.x));
    loY = Math.max(loY, Math.min(0, -b.y - pl.y));
    hiY = Math.min(hiY, Math.max(0, b.y - pl.y));
  }
  const dx = Math.max(loX, Math.min(hiX, d.x));
  const dy = Math.max(loY, Math.min(hiY, d.y));
  const out = starts.slice();
  for (const i of ids) {
    const pl = starts[i];
    if (pl) out[i] = { ...pl, x: pl.x + dx, y: pl.y + dy };
  }
  return out;
}

/**
 * Several sheets turned as one by `by` radians round `centre` (an offset from home, as
 * groupCentre gives): each goes round it and turns as much, and stays at that angle (its aim).
 */
export function twistGroup(placements: Placement[], ids: number[], centre: { x: number; y: number }, by: number): Placement[] {
  'worklet';
  const c = Math.cos(by);
  const s = Math.sin(by);
  const out = placements.slice();
  for (const i of ids) {
    const pl = placements[i];
    if (!pl) continue;
    const dx = pl.x - centre.x;
    const dy = pl.y - centre.y;
    const turned = twistPlacement(pl, by);
    out[i] = { ...turned, x: centre.x + dx * c - dy * s, y: centre.y + dx * s + dy * c };
  }
  return out;
}
