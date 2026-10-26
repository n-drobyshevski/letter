import { mulberry32, range, subSeed, wobble } from '../lib/random';

/**
 * Breaking the wax seal, as geometry (no Skia, so it can be tested).
 *
 * The seal sits across the flap tip. When the flap is pulled up, brittle wax splits
 * along the flap's edge: the part on the flap lifts with it, the part on the body
 * stays. The break is jagged where it runs through wax and follows the paper edge
 * elsewhere. All of it is seeded, so both phones break the same seal the same way.
 */

export type BreakGeometry = {
  /** Closed polygon [x0, y0, x1, y1, …]: the flap, with a jagged edge through the wax. */
  flapPiece: number[];
  /** Open polyline along the break, only where it runs through the wax. */
  crack: number[];
};

type Geo = {
  width: number;
  flapTip: number;
  seal: { x: number; y: number; maxR: number };
};

export function breakGeometry(g: Geo, seed: number): BreakGeometry {
  const rand = mulberry32(subSeed(seed, 'seal-break'));
  const { x: cx, y: cy, maxR } = g.seal;
  const tip: [number, number] = [g.seal.x, g.flapTip];
  const flapPiece: number[] = [0, 0];
  const crack: number[] = [];
  let jag = 0;

  const edge = (from: [number, number], to: [number, number]) => {
    const n = 80;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      let x = from[0] + (to[0] - from[0]) * t;
      let y = from[1] + (to[1] - from[1]) * t;
      const d = Math.hypot(x - cx, y - cy);
      if (d < maxR * 1.12) {
        // Through the wax the break wanders: a random walk, pulled back to the paper edge.
        jag = jag * 0.55 + wobble(rand, 2.4);
        const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
        const nx = -(to[1] - from[1]) / len;
        const ny = (to[0] - from[0]) / len;
        const fade = 1 - Math.max(0, (d - maxR * 0.85) / (maxR * 0.27));
        x += nx * jag * fade;
        y += ny * jag * fade;
        if (d < maxR * 1.04) crack.push(x, y);
      }
      flapPiece.push(x, y);
    }
  };
  edge([0, 0], tip);
  edge(tip, [g.width, 0]);
  return { flapPiece, crack };
}

export type Crumb = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  /** Radius of each vertex of an irregular polygon. */
  shape: number[];
  /** How far below its start it lands (on the envelope or the desk). */
  land: number;
};

/** A few chips of wax flung off the break: 1.3–4 pt, up and outwards. */
export function crumbs(crack: number[], seed: number, count = 4): Crumb[] {
  const rand = mulberry32(subSeed(seed, 'crumbs'));
  const pts = crack.length / 2;
  return Array.from({ length: count }, () => {
    const i = Math.floor(rand() * pts) * 2;
    const size = range(rand, 1.3, 4);
    return {
      x: crack[i] ?? 0,
      y: crack[i + 1] ?? 0,
      vx: (rand() > 0.5 ? 1 : -1) * range(rand, 60, 220),
      vy: -range(rand, 220, 420),
      spin: wobble(rand, 14),
      shape: Array.from({ length: 6 }, () => size * range(rand, 0.6, 1.15)),
      land: range(rand, 18, 60),
    };
  });
}

export const GRAVITY = 2000; // pt/s²

/** Closed-form flight of a crumb at time t (s): deterministic, so QA frames can freeze it. */
export function crumbAt(c: Crumb, t: number) {
  'worklet';
  const x = c.x + c.vx * t;
  const y = Math.min(c.y + c.vy * t + 0.5 * GRAVITY * t * t, c.y + c.land);
  return { x, y, angle: c.spin * Math.min(t, 0.4) };
}

/**
 * Where the flap was glued, the paper tears: light fibrous patches along 30–60 %
 * of the flap's edges, revealed on the body once the flap lifts.
 * Returns segments [x0, y0, x1, y1] along the flap's two edges.
 */
export function fibreTears(g: Geo, seed: number): number[][] {
  const rand = mulberry32(subSeed(seed, 'fibres'));
  const tip: [number, number] = [g.seal.x, g.flapTip];
  const out: number[][] = [];
  for (const [from, to] of [
    [[0, 0], tip],
    [tip, [g.width, 0]],
  ] as [[number, number], [number, number]][]) {
    let t = range(rand, 0.15, 0.3);
    while (t < 0.95) {
      const len = range(rand, 0.05, 0.14);
      const t1 = Math.min(t + len, 0.97);
      out.push([
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[0] + (to[0] - from[0]) * t1,
        from[1] + (to[1] - from[1]) * t1,
      ]);
      t = t1 + range(rand, 0.06, 0.16);
    }
  }
  return out;
}
