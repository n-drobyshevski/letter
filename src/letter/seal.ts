import { mulberry32, subSeed, wobble } from '../lib/random';
import { DEFAULT_SEAL_DIE, parseSealDie, type SealDie } from './sealDies';

/**
 * The wax seal as data: where the sender poured the wax and pressed the die, how it is
 * stored (`letters.envelope.seal`), and its exact shape in JS (a twin of WAX_SKSL v2:
 * same edge noise, same stretch, same drop union, same press spread).
 *
 * Pure: no Skia, no stationery (which loads font files), so the mailbox parser, tests,
 * hit tests, the seal break and the flexible-wax film can all share it. Everything a
 * derived value or gesture may call is a worklet.
 *
 * Coordinates: positions are fractions of the envelope BACK, flap up, unmirrored, origin
 * top-left; sizes are mm (pxPerMm = g.unit / 110). The outline noise is seeded from the
 * envelope's seed, so both phones draw the same seal.
 */

export type { SealDie } from './sealDies';

// --- The envelope's pure measurements (envelope.ts re-exports them) ---------------------

/**
 * ISO 269 envelope sizes (mm), one per fold: an A4 folded in three goes in a DL,
 * folded in half (A5) in a C5, folded in four (A6, turned sideways) in a C6.
 */
export type EnvelopeFormat = 'DL' | 'C5' | 'C6';
export const ENVELOPE_MM: Record<EnvelopeFormat, { w: number; h: number }> = {
  DL: { w: 220, h: 110 },
  C5: { w: 229, h: 162 },
  C6: { w: 162, h: 114 },
};

/** The closed flap's tip, as a fraction of the envelope's height. */
export const FLAP_TIP = 0.56;
/** How much the flap's tip is rounded off, as a fraction of the envelope's height. */
export const TIP_ROUND = 0.14;
/** The most wax one pour gives: the puddle radius at pour = 1 (today's maxR = 0.17 unit). */
export const WAX_MAX_MM = 110 * 0.17;
/** The brass die's radius (today's stampR = 0.72 maxR, a 27 mm die). */
export const DIE_R_MM = WAX_MAX_MM * 0.72;

/** Stored ranges. Anything inside the "accept" range is clamped to the "keep" range; outside it is garbage. */
export const SEAL_LIMITS = {
  puddleMm: [3, 20],
  dieMm: [8, 16],
  dropMm: [0.5, 3],
  depth: [0.35, 1],
  stretch: 0.4,
  drops: 2,
  /** The die may hang off the envelope a little (it only has to touch the wax). */
  stampPos: [-0.25, 1.25],
} as const;

/** Px per mm on an envelope drawn `w` × `h` px (envelopeGeometry's unit / 110). */
export function pxPerMm(w: number, h: number, format: EnvelopeFormat) {
  'worklet';
  return (format === 'DL' ? h : (w / ENVELOPE_MM[format].w) * 110) / 110;
}

/**
 * The flap tip's x as a fraction of the width: hand-folded envelopes are never exactly
 * symmetric. The single source for envelopeGeometry (which passes its own stream: this
 * is the first wobble drawn from it) and for everything that classifies a seal.
 */
export function tipFraction(seed: number, rand: () => number = mulberry32(subSeed(seed, 'envelope'))): number {
  return 0.5 + wobble(rand, 0.006);
}

/** What the flap-edge maths needs; EnvelopeGeometry satisfies it (px), flapGeo builds it (mm or px). */
export type FlapGeo = { width: number; height: number; flapTip: number; tip: { x: number; y: number } };

/** The flap's shape for an envelope of this format and seed, in mm by default, or at `width` × `height` px. */
export function flapGeo(
  format: EnvelopeFormat,
  seed: number,
  width = ENVELOPE_MM[format].w,
  height = ENVELOPE_MM[format].h,
): FlapGeo {
  const flapTip = height * FLAP_TIP;
  return { width, height, flapTip, tip: { x: width * tipFraction(seed), y: flapTip } };
}

/**
 * The closed flap's lower edge at x: the two V lines, rounded off at the tip exactly as
 * envelope.ts's roundedTriangle does (a quad with the tip as control point). 0 off the paper.
 * Above it (y < edgeYAt) is the flap, below it the body.
 */
export function edgeYAt(g: FlapGeo, x: number): number {
  'worklet';
  const { width: w, tip } = g;
  if (x <= 0 || x >= w) return 0;
  const r = g.height * TIP_ROUND;
  // Where the straight edges end, r short of the tip (roundedTriangle's `toward`).
  const la = Math.hypot(tip.x, tip.y);
  const lb = Math.hypot(w - tip.x, tip.y);
  const ka = Math.max(0, (la - r) / la);
  const kb = Math.max(0, (lb - r) / lb);
  const p1x = tip.x * ka;
  const p1y = tip.y * ka;
  const p2x = w + (tip.x - w) * kb;
  const p2y = tip.y * kb;
  if (x <= p1x) return (tip.y * x) / tip.x;
  if (x >= p2x) return (tip.y * (w - x)) / (w - tip.x);
  // Quad p1 → (tip) → p2: solve x(t) = x, monotonic in t since p1x < tip.x < p2x.
  const a = p1x - 2 * tip.x + p2x;
  const b = 2 * (tip.x - p1x);
  const c = p1x - x;
  let t: number;
  if (Math.abs(a) < 1e-9) t = -c / b;
  else t = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
  t = Math.min(1, Math.max(0, t));
  const u = 1 - t;
  return u * u * p1y + 2 * t * u * tip.y + t * t * p2y;
}

// --- Stored and resolved placements --------------------------------------------------

export type SealHold = 'straddle' | 'flap' | 'body';

/** The pressed die, stored. */
export type SealStamp = {
  /** Die centre, fraction of the back; independent of the puddle (may hang off it). */
  x: number;
  y: number;
  /** Die radius, mm (8..16; the UI uses DIE_R_MM). */
  rMm: number;
  /** Radians, clockwise, 0 = upright for someone reading the back. */
  rot: number;
  /** How warm the wax was at the press, 0.35..1 (1 = crisp and deep). */
  depth: number;
};

/** letters.envelope.seal, v1. */
export type SealPlacement = {
  v: 1;
  /** Puddle centre, fraction of the back (0..1). */
  x: number;
  y: number;
  /** Puddle radius before pressing, mm (3..20; a full pour is WAX_MAX_MM). */
  rMm: number;
  /** Elongation from steering the pour: direction × amount, |s| ≤ 0.4. */
  stretch?: [number, number];
  /** Satellite drops [fx, fy, rMm], at most 2. */
  drops?: [number, number, number][];
  /** null = wax only, never pressed. */
  stamp: SealStamp | null;
};

/**
 * A placement resolved to envelope-local px: what WAX_SKSL v2 and every geometry function
 * here take. `r` is the base radius before pressing (the press spread is in the shader
 * and in coverSD).
 */
export type SealPx = {
  x: number;
  y: number;
  r: number;
  stretch: [number, number];
  /** [x, y, r] px; r = 0 means none. */
  drops: [number, number, number][];
  stamp: { x: number; y: number; r: number; angle: number; depth: number } | null;
  /** The envelope's seed (the outline noise). */
  seed: number;
};

const clamp = (v: number, lo: number, hi: number) => {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
};

/** Radians wrapped to [-π, π]. */
const wrapAngle = (a: number) => {
  'worklet';
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
};

/** Today's seal, for letters stored without one: a full pour on the flap tip, the monogram die centred, upright, deep. */
export function defaultSeal(format: EnvelopeFormat, seed: number): SealPlacement {
  const x = tipFraction(seed);
  // envelopeGeometry's seal: flapTip - 0.2 maxR.
  const y = FLAP_TIP - (0.2 * WAX_MAX_MM) / ENVELOPE_MM[format].h;
  return { v: 1, x, y, rMm: WAX_MAX_MM, stamp: { x, y, rMm: DIE_R_MM, rot: 0, depth: 1 } };
}

/** The die stored next to the seal (letters.envelope.die): unknown → the monogram. */
export const parseDie = (raw: unknown): SealDie => parseSealDie(raw);
export { DEFAULT_SEAL_DIE };

/** Stored placement → px on an envelope drawn `w` × `h`. */
export function sealToPx(p: SealPlacement, w: number, h: number, format: EnvelopeFormat, seed: number): SealPx {
  'worklet';
  const k = pxPerMm(w, h, format);
  const drops: [number, number, number][] = [];
  for (const [fx, fy, r] of p.drops ?? []) drops.push([fx * w, fy * h, r * k]);
  return {
    x: p.x * w,
    y: p.y * h,
    r: p.rMm * k,
    stretch: p.stretch ? [p.stretch[0], p.stretch[1]] : [0, 0],
    drops,
    stamp: p.stamp ? { x: p.stamp.x * w, y: p.stamp.y * h, r: p.stamp.rMm * k, angle: p.stamp.rot, depth: p.stamp.depth } : null,
    seed,
  };
}

/**
 * Px → stored placement, clamped into the stored ranges (so what the sender saves is
 * exactly what the recipient's parseSeal reads back). Zero stretch and empty drops are left out.
 */
export function sealFromPx(s: SealPx, w: number, h: number, format: EnvelopeFormat): SealPlacement {
  'worklet';
  const k = pxPerMm(w, h, format);
  const L = SEAL_LIMITS;
  const out: SealPlacement = {
    v: 1,
    x: clamp(s.x / w, 0, 1),
    y: clamp(s.y / h, 0, 1),
    rMm: clamp(s.r / k, L.puddleMm[0], L.puddleMm[1]),
    stamp: s.stamp
      ? {
          x: clamp(s.stamp.x / w, L.stampPos[0], L.stampPos[1]),
          y: clamp(s.stamp.y / h, L.stampPos[0], L.stampPos[1]),
          rMm: clamp(s.stamp.r / k, L.dieMm[0], L.dieMm[1]),
          rot: wrapAngle(s.stamp.angle),
          depth: clamp(s.stamp.depth, L.depth[0], L.depth[1]),
        }
      : null,
  };
  const e = Math.hypot(s.stretch[0], s.stretch[1]);
  if (e > 0.001) {
    const m = Math.min(e, L.stretch) / e;
    out.stretch = [s.stretch[0] * m, s.stretch[1] * m];
  }
  const drops: [number, number, number][] = [];
  for (const [dx, dy, dr] of s.drops) {
    if (dr > 0 && drops.length < L.drops)
      drops.push([clamp(dx / w, 0, 1), clamp(dy / h, 0, 1), clamp(dr / k, L.dropMm[0], L.dropMm[1])]);
  }
  if (drops.length) out.drops = drops;
  return out;
}

/** A finite number within [lo, hi], else null. */
const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Runtime check of a stored seal (server JSON is untrusted): jsonb_typeof-style shape
 * checks, then plausible values are clamped into the stored ranges (float noise, a puddle
 * a hair past the edge) and anything else is garbage → null. Legacy rows (no seal) → null,
 * and the caller falls back to defaultSeal.
 */
export function parseSeal(raw: unknown): SealPlacement | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  const L = SEAL_LIMITS;
  const x = num(raw.x, -0.5, 1.5);
  const y = num(raw.y, -0.5, 1.5);
  const rMm = num(raw.rMm, 0.1, 40);
  if (x === null || y === null || rMm === null) return null;

  let stamp: SealStamp | null = null;
  if (raw.stamp !== undefined && raw.stamp !== null) {
    const st = raw.stamp;
    if (!isObj(st)) return null;
    const sx = num(st.x, -1, 2);
    const sy = num(st.y, -1, 2);
    const sr = num(st.rMm, 0.1, 40);
    const rot = num(st.rot, -1000, 1000);
    const depth = num(st.depth, 0, 1.5);
    if (sx === null || sy === null || sr === null || rot === null || depth === null) return null;
    stamp = {
      x: clamp(sx, L.stampPos[0], L.stampPos[1]),
      y: clamp(sy, L.stampPos[0], L.stampPos[1]),
      rMm: clamp(sr, L.dieMm[0], L.dieMm[1]),
      rot: wrapAngle(rot),
      depth: clamp(depth, L.depth[0], L.depth[1]),
    };
  }
  const out: SealPlacement = { v: 1, x: clamp(x, 0, 1), y: clamp(y, 0, 1), rMm: clamp(rMm, L.puddleMm[0], L.puddleMm[1]), stamp };

  if (raw.stretch !== undefined && raw.stretch !== null) {
    const s = raw.stretch;
    if (!Array.isArray(s) || s.length !== 2) return null;
    const a = num(s[0], -2, 2);
    const b = num(s[1], -2, 2);
    if (a === null || b === null) return null;
    const e = Math.hypot(a, b);
    if (e > 2) return null;
    if (e > 0.001) {
      const m = Math.min(e, L.stretch) / e;
      out.stretch = [a * m, b * m];
    }
  }

  if (raw.drops !== undefined && raw.drops !== null) {
    const d = raw.drops;
    if (!Array.isArray(d) || d.length > L.drops) return null;
    const drops: [number, number, number][] = [];
    for (const drop of d) {
      if (!Array.isArray(drop) || drop.length !== 3) return null;
      const fx = num(drop[0], -0.5, 1.5);
      const fy = num(drop[1], -0.5, 1.5);
      const r = num(drop[2], 0.01, 10);
      if (fx === null || fy === null || r === null) return null;
      drops.push([clamp(fx, 0, 1), clamp(fy, 0, 1), clamp(r, L.dropMm[0], L.dropMm[1])]);
    }
    if (drops.length) out.drops = drops;
  }
  return out;
}

// --- The geometry twin of WAX_SKSL v2 ----------------------------------------------------

/** WAX_SKSL's uSeed for an envelope seed (anything not a finite number counts as 0: never a NaN outline). */
export const shaderSeed = (seed: number) => {
  'worklet';
  return Number.isFinite(seed) ? (seed % 97) * 0.37 : 0;
};

/** The puddle's noisy radius at angle a (the shader's edgeR). */
export function edgeR(p: SealPx, a: number) {
  'worklet';
  const s = shaderSeed(p.seed);
  return (
    p.r *
    (1 +
      0.055 * Math.sin(3 * a + s) +
      0.035 * Math.sin(5 * a + s * 1.7) +
      0.02 * Math.sin(9 * a + s * 0.3) +
      0.012 * Math.sin(17 * a + s * 2.1))
  );
}

const smoothstep = (e0: number, e1: number, x: number) => {
  'worklet';
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function unstretch(p: SealPx, dx: number, dy: number): [number, number] {
  'worklet';
  const e = Math.hypot(p.stretch[0], p.stretch[1]);
  if (e < 0.001) return [dx, dy];
  const ux = p.stretch[0] / e;
  const uy = p.stretch[1] / e;
  const a = dx * ux + dy * uy;
  const b = -dx * uy + dy * ux;
  const lead = smoothstep(-p.r * 0.6, p.r * 0.6, a);
  return [a / (1 + e * (0.55 + 0.9 * lead)), b * (1 + 0.45 * e)];
}

const smaxk = (a: number, b: number, k: number) => {
  'worklet';
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
};

/** Signed distance to the puddle's edge before the press, px, positive inside (the shader's puddleSD). */
export function puddleSD(p: SealPx, x: number, y: number) {
  'worklet';
  const [ax, by] = unstretch(p, x - p.x, y - p.y);
  let sd = edgeR(p, Math.atan2(by, ax + 0.0001)) - Math.hypot(ax, by);
  for (const [dx, dy, dr] of p.drops) if (dr > 0) sd = smaxk(sd, dr - Math.hypot(x - dx, y - dy), dr * 0.9);
  return sd;
}

/** Wax coverage after the press (the shader's `cover`): positive = wax, ~px from the edge. */
export function coverSD(p: SealPx, x: number, y: number) {
  'worklet';
  const sd = puddleSD(p, x, y);
  if (!p.stamp) return sd;
  const rs = Math.hypot(x - p.stamp.x, y - p.stamp.y);
  const spread = p.r * 0.1 * p.stamp.depth;
  const inDie = 1 - smoothstep(p.stamp.r - 0.7, p.stamp.r + 0.7, rs);
  const near = Math.exp(-Math.max(rs - p.stamp.r, 0) / (p.stamp.r * 0.3));
  const out = sd + spread * near;
  const under = Math.max(sd, Math.min(sd + spread, p.stamp.r - rs));
  return out + (under - out) * inDie;
}

/** Whether (x, y) is on the wax. */
export const inWax = (p: SealPx, x: number, y: number) => {
  'worklet';
  return coverSD(p, x, y) > 0;
};

export type SealBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/**
 * Axis-aligned box the shader's Rect must cover: wax + lip + drops + an overhanging die +
 * the shadow cast inside the shader. Also the flap clip, the posting snag and hit areas.
 */
export function sealBounds(p: SealPx): SealBounds {
  'worklet';
  const e = Math.hypot(p.stretch[0], p.stretch[1]);
  const R = p.r * 1.12 * (1 + e * 1.45) + 6;
  let x0 = p.x - R;
  let y0 = p.y - R;
  let x1 = p.x + R;
  let y1 = p.y + R;
  for (const [dx, dy, dr] of p.drops) {
    if (dr > 0) {
      x0 = Math.min(x0, dx - dr * 1.3);
      y0 = Math.min(y0, dy - dr * 1.3);
      x1 = Math.max(x1, dx + dr * 1.3);
      y1 = Math.max(y1, dy + dr * 1.3);
    }
  }
  if (p.stamp) {
    const s = p.stamp.r * 1.3 + 4;
    x0 = Math.min(x0, p.stamp.x - s);
    y0 = Math.min(y0, p.stamp.y - s);
    x1 = Math.max(x1, p.stamp.x + s);
    y1 = Math.max(y1, p.stamp.y + s);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, minX: x0, minY: y0, maxX: x1, maxY: y1 };
}

/**
 * Whether a die pressed at `die` (default: p.stamp) would touch the puddle at all; if
 * not it is a miss and leaves nothing. Tested against the wax before the press.
 */
export function pressTouches(p: SealPx, die: { x: number; y: number; r: number } | null = p.stamp): boolean {
  'worklet';
  if (!die) return false;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    for (const f of [0, 0.5, 0.9])
      if (puddleSD(p, die.x + Math.cos(a) * die.r * f, die.y + Math.sin(a) * die.r * f) > 1) return true;
  }
  return false;
}

/**
 * The outline as a closed polygon [x0, y0, …] (drop shadow, flexible-wax film, clips).
 * The main body only: satellite drops are separate circles (a ray would join them with a spike).
 */
export function outline(seal: SealPx, n = 96): number[] {
  'worklet';
  const p: SealPx = { ...seal, drops: [] };
  const out: number[] = [];
  const reach = p.r * 2.2 + (p.stamp ? Math.hypot(p.stamp.x - p.x, p.stamp.y - p.y) + p.stamp.r : 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    // Outermost crossing: step out coarsely, then bisect the last inside → outside step.
    let last = 0;
    for (let t = 0; t <= reach; t += 0.5) if (coverSD(p, p.x + cx * t, p.y + cy * t) > 0) last = t;
    let lo = last;
    let hi = last + 0.5;
    for (let k = 0; k < 12; k++) {
      const m = (lo + hi) / 2;
      if (coverSD(p, p.x + cx * m, p.y + cy * m) > 0) lo = m;
      else hi = m;
    }
    out.push(p.x + cx * lo, p.y + cy * lo);
  }
  return out;
}

/**
 * The transit crack (replaces envelopeFront's sealCrackPath): a jagged line across the
 * wax through the die's centre (or the puddle's), ending 5 % short of the real outline.
 * A die hanging off the puddle may have its centre on bare paper: then the crack runs
 * through the deepest wax between the die and the puddle's centre instead. Every vertex
 * stays on the wax. Seeded like the old one (subSeed(seed, 'crack')). Polyline
 * [x0, y0, …]; the caller makes the path.
 */
export function sealCrack(p: SealPx, seed: number): number[] {
  const rand = mulberry32(subSeed(seed, 'crack'));
  let cx = p.stamp?.x ?? p.x;
  let cy = p.stamp?.y ?? p.y;
  if (coverSD(p, cx, cy) <= 0.2 * p.r) {
    let best = coverSD(p, p.x, p.y);
    let bx = p.x;
    let by = p.y;
    for (let i = 0; i < 16; i++) {
      const t = i / 16;
      const x = cx + (p.x - cx) * t;
      const y = cy + (p.y - cy) * t;
      const sd = coverSD(p, x, y);
      if (sd > best) {
        best = sd;
        bx = x;
        by = y;
      }
    }
    cx = bx;
    cy = by;
  }
  const a = rand() * Math.PI;
  const reachAlong = (dx: number, dy: number) => {
    let t = 0;
    while (t < p.r * 3 && coverSD(p, cx + dx * (t + 0.5), cy + dy * (t + 0.5)) > 0) t += 0.5;
    return t * 0.95;
  };
  const r0 = reachAlong(Math.cos(a), Math.sin(a));
  const r1 = reachAlong(-Math.cos(a), -Math.sin(a));
  const out: number[] = [];
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const d = r0 - (r0 + r1) * t;
    const jag = i === 0 || i === steps ? 0 : (rand() * 2 - 1) * p.r * 0.08;
    let x = cx + Math.cos(a) * d - Math.sin(a) * jag;
    let y = cy + Math.sin(a) * d + Math.cos(a) * jag;
    if (coverSD(p, x, y) <= 0.5) {
      // A jag off a thin edge: pulled back towards the anchor until it is on the wax.
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 10; k++) {
        const m = (lo + hi) / 2;
        if (coverSD(p, cx + (x - cx) * m, cy + (y - cy) * m) > 0.5) lo = m;
        else hi = m;
      }
      x = cx + (x - cx) * lo;
      y = cy + (y - cy) * lo;
    }
    out.push(x, y);
  }
  return out;
}

// --- What the seal does ---------------------------------------------------------------------

/**
 * Whether the seal holds the flap shut: 'straddle' if both the flap and the body carry
 * enough wax to bond to: 40 mm² each (a 7 mm disc), or 20 % of the wax for a seal too
 * small for that. Else the side with more ('flap': it rides the flap when opened;
 * 'body': decoration, only the knife opens it). Sampled on a 32 × 32 grid in mm space,
 * pure and deterministic from (seal, format, seed), so sender, recipient and tests agree.
 */
export const HOLD_MM2 = 40;
export function sealHold(p: SealPlacement, format: EnvelopeFormat, seed: number): SealHold {
  const mm = ENVELOPE_MM[format];
  const s = sealToPx(p, mm.w, mm.h, format, seed); // 1 px = 1 mm
  const g = flapGeo(format, seed);
  const b = sealBounds(s);
  const N = 32;
  let flap = 0;
  let body = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = b.minX + ((i + 0.5) / N) * b.width;
      const y = b.minY + ((j + 0.5) / N) * b.height;
      const sd = coverSD(s, x, y);
      if (x < 0 || x > mm.w || y < 0 || y > mm.h || !(sd > 0)) continue;
      if (y < edgeYAt(g, x)) flap++;
      else body++;
    }
  }
  const total = flap + body;
  if (total === 0) return 'body';
  const cell = (b.width * b.height) / (N * N); // mm² per sample
  const need = Math.min(HOLD_MM2, 0.2 * total * cell);
  if (flap * cell >= need && body * cell >= need) return 'straddle';
  return flap > body ? 'flap' : 'body';
}

/** Die depth from how far the wax has cooled (0 just poured … 1 set): full until 0.4, then down to 0.35. */
export function pressDepth(cool: number) {
  'worklet';
  const c = clamp(cool, 0, 1);
  return c < 0.4 ? 1 : 1 - (0.65 * (c - 0.4)) / 0.6;
}

/**
 * The nearest allowed puddle centre for a puddle of radius r (px): the wax (with its lip,
 * r × 1.15) stays 2 mm inside the envelope. `k` is pxPerMm.
 */
export function clampPuddleCentre(x: number, y: number, r: number, w: number, h: number, k: number) {
  'worklet';
  const m = r * 1.15 + 2 * k;
  return { x: m * 2 > w ? w / 2 : clamp(x, m, w - m), y: m * 2 > h ? h / 2 : clamp(y, m, h - m) };
}

// --- QA ----------------------------------------------------------------------------------

/** Ready-made placements for the labs and QA shots (?hold=). */
export type SealPreset = 'tip' | 'left' | 'flap' | 'body';
export const SEAL_PRESETS: readonly SealPreset[] = ['tip', 'left', 'flap', 'body'];

/** A full pour with the die centred on it, at a preset spot: 'left' sits on the left V edge, 'flap' deep on the flap, 'body' low on the body. */
export function presetSeal(preset: SealPreset, format: EnvelopeFormat, seed: number): SealPlacement {
  const base = defaultSeal(format, seed);
  if (preset === 'tip') return base;
  const tip = tipFraction(seed);
  const [x, y] = preset === 'left' ? [0.3, FLAP_TIP * (0.3 / tip)] : preset === 'flap' ? [tip, 0.2] : [0.5, 0.8];
  return { ...base, x, y, stamp: base.stamp && { ...base.stamp, x, y } };
}

/**
 * A placement from lab/QA params (useLabParams): `hold` picks a preset (default: today's
 * seal), `sx, sy` move the puddle, `kx, ky` the die (default: on the puddle), `rot` turns
 * it, `depth` sets how warm it was. undefined when none is given, so the default path runs.
 */
export function sealFromParams(
  q: { sx?: number; sy?: number; kx?: number; ky?: number; rot?: number; depth?: number; hold?: string },
  format: EnvelopeFormat,
  seed: number,
): SealPlacement | undefined {
  const preset = SEAL_PRESETS.find((p) => p === q.hold);
  if (!preset && [q.sx, q.sy, q.kx, q.ky, q.rot, q.depth].every((v) => v === undefined)) return undefined;
  const base = presetSeal(preset ?? 'tip', format, seed);
  // The puddle stays on the paper, as the ceremony keeps it (clampPuddleCentre, in mm here).
  const { w, h } = ENVELOPE_MM[format];
  const c = clampPuddleCentre((q.sx ?? base.x) * w, (q.sy ?? base.y) * h, base.rMm, w, h, 1);
  const x = q.sx === undefined ? base.x : c.x / w;
  const y = q.sy === undefined ? base.y : c.y / h;
  const st = base.stamp!;
  const raw = {
    ...base,
    x,
    y,
    stamp: {
      ...st,
      x: q.kx ?? (q.sx !== undefined ? x : st.x),
      y: q.ky ?? (q.sy !== undefined ? y : st.y),
      rot: q.rot ?? st.rot,
      depth: q.depth ?? st.depth,
    },
  };
  return parseSeal(raw) ?? base;
}
