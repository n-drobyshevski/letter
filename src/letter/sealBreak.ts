import { mulberry32, range, subSeed, wobble } from '../lib/random';
import { coverSD, edgeYAt, sealBounds, type FlapGeo, type SealPx } from './seal';

/**
 * Breaking the wax seal, as geometry (no Skia, so it can be tested).
 *
 * The seal sits across the closed flap's edge: at the tip, or anywhere along either side
 * of the V. When the flap is pulled up, brittle wax splits along that edge: the part on
 * the flap lifts with it, the part on the body stays. The break is jagged where it runs
 * through wax (the real shape, seal.ts's coverSD) and follows the paper edge (with its
 * rounded tip) elsewhere. All of it is seeded, so both phones break the same seal the same way.
 *
 * Only a seal that straddles the edge (seal.ts's sealHold) breaks; one wholly on the flap
 * or the body is decoration and the knife opens the envelope.
 */

export type BreakGeometry = {
  /** Closed polygon [x0, y0, x1, y1, …]: the flap, with a jagged edge through the wax. */
  flapPiece: number[];
  /** Open polyline along the break, only where it runs through the wax. */
  crack: number[];
};

/** The closed flap: EnvelopeGeometry satisfies it (px), seal.ts's flapGeo builds it. */
type Geo = FlapGeo;

/** Points along the closed flap's lower edge, (0, 0) → (width, 0), about `step` apart, with the unit normal at each. */
function edgeWalk(g: Geo, step: number): { x: number; y: number; nx: number; ny: number }[] {
  const w = g.width;
  const n = Math.ceil(w / 0.25);
  const out: { x: number; y: number; nx: number; ny: number }[] = [];
  let px = 0;
  let py = 0;
  let along = 0;
  for (let i = 1; i <= n; i++) {
    const x = i === n ? w : (i * w) / n;
    const y = i === n ? 0 : edgeYAt(g, x);
    along += Math.hypot(x - px, y - py);
    if (along >= step || i === n) {
      // The normal of the local tangent (1, dy/dx).
      const d = edgeYAt(g, Math.min(w, x + 0.5)) - edgeYAt(g, Math.max(0, x - 0.5));
      const len = Math.hypot(1, d);
      out.push({ x, y, nx: -d / len, ny: 1 / len });
      along = 0;
    }
    px = x;
    py = y;
  }
  return out;
}

/**
 * The break for the wax `wax` (px, from sealToPx) on the flap `g`. The jag scales with the
 * seal (2.4 pt and a point every 2.4 pt on today's 30 pt seal), so a small seal far down
 * a V edge breaks as raggedly as a big one on the tip.
 */
export function breakGeometry(g: Geo, wax: SealPx, seed: number): BreakGeometry {
  const rand = mulberry32(subSeed(seed, 'seal-break'));
  const R = wax.r;
  const amp = R * 0.082;
  const b = sealBounds(wax);
  const flapPiece: number[] = [0, 0];
  const crack: number[] = [];
  let jag = 0;
  for (const p of edgeWalk(g, Math.min(3, Math.max(0.8, R * 0.08)))) {
    let { x, y } = p;
    const inBox = x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
    const sd = inBox && R > 0 ? coverSD(wax, x, y) : -Infinity;
    if (sd > -0.12 * R) {
      // Through the wax the break wanders: a random walk, pulled back to the paper edge.
      jag = jag * 0.55 + wobble(rand, amp);
      const fade = Math.min(1, (sd + 0.12 * R) / (0.27 * R));
      x += p.nx * jag * fade;
      y += p.ny * jag * fade;
      if (sd > -0.04 * R) crack.push(x, y);
    }
    flapPiece.push(x, y);
  }
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

/** When a crumb lands (s): the positive root of vy·t + G·t²/2 = land. */
export function crumbLandsAt(c: Crumb) {
  'worklet';
  return (-c.vy + Math.sqrt(c.vy * c.vy + 2 * GRAVITY * c.land)) / GRAVITY;
}

/**
 * Closed-form flight of a crumb at time t (s): deterministic, so QA frames can freeze it.
 * Once down it stays down: a short skid (≤ 4 % of its flight speed × 1 s), then still.
 * `fall`: it left the paper (landed off the envelope), so it drops on past `land`.
 */
export function crumbAt(c: Crumb, t: number, fall = false) {
  'worklet';
  const tl = crumbLandsAt(c);
  const flying = Math.min(t, tl);
  const skid = t > tl && !fall ? c.vx * 0.04 * (1 - Math.exp(-(t - tl) / 0.05)) : 0;
  const x = c.x + c.vx * (fall ? t : flying) + skid;
  const yFree = c.y + c.vy * t + 0.5 * GRAVITY * t * t;
  const y = fall ? yFree : Math.min(yFree, c.y + c.land);
  return { x, y, angle: c.spin * Math.min(t, tl, 0.4) };
}

/** Whether a crumb comes down on the envelope (else it falls off the paper). */
export function crumbLandsOn(c: Crumb, rect: { x: number; y: number; width: number; height: number }) {
  const tl = crumbLandsAt(c);
  const x = c.x + c.vx * tl;
  const y = c.y + c.land;
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/**
 * Where the flap was glued, the paper tears: light fibrous patches along 30–60 %
 * of the flap's edges, revealed on the body once the flap lifts.
 * Returns segments [x0, y0, x1, y1] along the flap's two edges.
 */
export function fibreTears(g: Geo, seed: number): number[][] {
  const rand = mulberry32(subSeed(seed, 'fibres'));
  const tip: [number, number] = [g.tip.x, g.flapTip];
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

/**
 * Flexible (modern) sealing wax doesn't crack: it bends, then lets go of the paper
 * whole and stays on the flap. Where it held the body it leaves a faint film and
 * lifts a few paper fibres. Segments [x0, y0, x1, y1] well inside the wax's real
 * footprint, below the flap edge (on the body), short and in random directions.
 */
export function residueFibres(g: Geo, wax: SealPx, seed: number, count = 9): number[][] {
  const rand = mulberry32(subSeed(seed, 'residue'));
  const b = sealBounds(wax);
  const out: number[][] = [];
  let guard = 0;
  while (out.length < count && guard++ < 1200) {
    const x = b.minX + rand() * b.width;
    const y = b.minY + rand() * b.height;
    // Inside the wax, away from its thin edge, and only where it sat on the body.
    if (coverSD(wax, x, y) < wax.r * 0.15) continue;
    if (y <= edgeYAt(g, x) + 1) continue;
    const dir = rand() * Math.PI * 2;
    const len = range(rand, 2, 5);
    out.push([x, y, x + Math.cos(dir) * len, y + Math.sin(dir) * len]);
  }
  return out;
}
