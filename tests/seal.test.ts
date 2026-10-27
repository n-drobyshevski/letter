import { test } from 'node:test';
import assert from 'node:assert/strict';

import { envelopeJson, getLastDie, setLastDie, type DraftEnvelope } from '../src/lib/draft';
import { mulberry32, subSeed, wobble } from '../src/lib/random';
import {
  DIE_R_MM,
  ENVELOPE_MM,
  FLAP_TIP,
  TIP_ROUND,
  WAX_MAX_MM,
  clampPuddleCentre,
  coverSD,
  defaultSeal,
  edgeYAt,
  flapGeo,
  inWax,
  outline,
  parseDie,
  parseSeal,
  pressDepth,
  pressTouches,
  presetSeal,
  pxPerMm,
  sealBounds,
  sealCrack,
  sealFromParams,
  sealFromPx,
  sealHold,
  sealToPx,
  tipFraction,
  type EnvelopeFormat,
  type SealPlacement,
  type SealPx,
} from '../src/letter/seal';
import { SEAL_DIE_ORDER, SEAL_DIES } from '../src/letter/sealDies';

const FORMATS: EnvelopeFormat[] = ['DL', 'C5', 'C6'];
const SEEDS = [1, 7, 1407, 99, 123456];
const WIDTHS = [287, 340, 361, 412, 480];

/** Mirrors envelopeGeometry's numbers as they were before seal.ts (envelope.ts needs Skia, so node can't import it). */
function legacyGeometry(width: number, seed: number, format: EnvelopeFormat) {
  const mm = ENVELOPE_MM[format];
  const height = Math.round((width * mm.h) / mm.w);
  const unit = format === 'DL' ? height : (width / mm.w) * 110;
  const rand = mulberry32(subSeed(seed, 'envelope'));
  const tipX = width / 2 + wobble(rand, width * 0.006);
  const flapTip = height * 0.56;
  const maxR = unit * 0.17;
  const bottomTip = width / 2 + wobble(rand, width * 0.004);
  return { width, height, unit, tipX, flapTip, bottomTip, seal: { x: tipX, y: flapTip - maxR * 0.2, maxR, stampR: maxR * 0.72 } };
}

test('defaultSeal reproduces the fixed seal of every existing letter', () => {
  for (const format of FORMATS) {
    for (const seed of SEEDS) {
      for (const w of WIDTHS) {
        const g = legacyGeometry(w, seed, format);
        const s = sealToPx(defaultSeal(format, seed), w, g.height, format, seed);
        const at = `${format} seed ${seed} w ${w}`;
        assert.ok(Math.abs(s.x - g.seal.x) < 1e-9, `x ${at}`);
        assert.ok(Math.abs(s.r - g.seal.maxR) < 1e-9, `r ${at}`);
        // y is a fraction of the height, which envelopeGeometry rounds to whole px: on C5/C6 that is
        // at most 3.74 mm × 0.5 px / h_mm, i.e. 1/60 px. Exact on DL.
        assert.ok(Math.abs(s.y - g.seal.y) < (format === 'DL' ? 1e-9 : 0.02), `y ${at}: ${s.y} vs ${g.seal.y}`);
        assert.ok(s.stamp, at);
        assert.ok(Math.abs(s.stamp.x - s.x) < 1e-12 && Math.abs(s.stamp.y - s.y) < 1e-12, `die centred ${at}`);
        assert.ok(Math.abs(s.stamp.r - g.seal.stampR) < 1e-9, `die r ${at}`);
        assert.equal(s.stamp.angle, 0);
        assert.equal(s.stamp.depth, 1);
        assert.deepEqual(s.drops, []);
        assert.deepEqual(s.stretch, [0, 0]);
      }
    }
  }
  assert.ok(Math.abs(WAX_MAX_MM - 18.7) < 1e-12);
  assert.ok(Math.abs(DIE_R_MM - 13.464) < 1e-12);
});

test('tipFraction is the envelope tip and leaves the stream as envelopeGeometry needs it', () => {
  for (const format of FORMATS) {
    for (const seed of SEEDS) {
      for (const w of WIDTHS) {
        const g = legacyGeometry(w, seed, format);
        assert.ok(Math.abs(w * tipFraction(seed) - g.tipX) < 1e-9, `${format} ${seed} ${w}`);
        // envelopeGeometry passes its own stream: the bottom flap's wobble must come out unchanged.
        const rand = mulberry32(subSeed(seed, 'envelope'));
        assert.ok(Math.abs(w * tipFraction(seed, rand) - g.tipX) < 1e-9);
        assert.equal(w / 2 + wobble(rand, w * 0.004), g.bottomTip);
        const f = flapGeo(format, seed, w, g.height);
        assert.equal(f.flapTip, g.flapTip);
        assert.equal(f.tip.x, w * tipFraction(seed));
      }
    }
  }
  assert.equal(FLAP_TIP, 0.56);
  assert.equal(TIP_ROUND, 0.14);
});

test('pxPerMm is the envelope unit / 110', () => {
  assert.equal(pxPerMm(340, 170, 'DL'), 170 / 110);
  assert.equal(pxPerMm(229, 162, 'C5'), 1);
  assert.equal(pxPerMm(162, 114, 'C6'), 1);
  assert.equal(pxPerMm(220, 110, 'DL'), 1);
});

const FULL: SealPlacement = {
  v: 1,
  x: 0.3,
  y: 0.32,
  rMm: 14.2,
  stretch: [0.21, -0.12],
  drops: [
    [0.36, 0.3, 1.8],
    [0.25, 0.4, 0.9],
  ],
  stamp: { x: 0.31, y: 0.33, rMm: DIE_R_MM, rot: 0.4, depth: 0.62 },
};

test('a seal survives JSON, px and back', () => {
  for (const p of [
    FULL,
    defaultSeal('C5', 7),
    { ...FULL, stamp: null },
    { v: 1, x: 0.5, y: 0.5, rMm: 10, stamp: null } as SealPlacement,
  ]) {
    assert.deepEqual(parseSeal(JSON.parse(JSON.stringify(p))), p);
    for (const format of FORMATS) {
      const mm = ENVELOPE_MM[format];
      const w = 412;
      const h = Math.round((w * mm.h) / mm.w);
      const back = sealFromPx(sealToPx(p, w, h, format, 1407), w, h, format);
      assert.equal(back.v, 1);
      assert.ok(Math.abs(back.x - p.x) < 1e-12 && Math.abs(back.y - p.y) < 1e-12 && Math.abs(back.rMm - p.rMm) < 1e-12);
      assert.equal(back.stamp === null, p.stamp === null);
      if (back.stamp && p.stamp) {
        for (const k of ['x', 'y', 'rMm', 'rot', 'depth'] as const) assert.ok(Math.abs(back.stamp[k] - p.stamp[k]) < 1e-12, k);
      }
      assert.equal(back.drops?.length ?? 0, p.drops?.length ?? 0);
      assert.equal(back.stretch === undefined, p.stretch === undefined);
      // What the sender saves is exactly what the recipient reads.
      assert.deepEqual(parseSeal(JSON.parse(JSON.stringify(back))), back);
    }
  }
});

test('sealFromPx clamps into what parseSeal accepts', () => {
  const s: SealPx = {
    x: -40,
    y: 900,
    r: 400,
    stretch: [3, 0],
    drops: [
      [10, 10, 99],
      [20, 20, 0.01],
      [30, 30, 2],
    ],
    stamp: { x: 2000, y: -500, r: 1, angle: 7, depth: 3 },
    seed: 1,
  };
  const p = sealFromPx(s, 340, 170, 'DL');
  assert.equal(p.x, 0);
  assert.equal(p.y, 1);
  assert.equal(p.rMm, 20);
  assert.deepEqual(p.stretch, [0.4, 0]);
  assert.equal(p.drops?.length, 2);
  assert.equal(p.stamp?.x, 1.25);
  assert.equal(p.stamp?.y, -0.25);
  assert.equal(p.stamp?.rMm, 8);
  assert.ok(Math.abs((p.stamp?.rot ?? 0) - (7 - 2 * Math.PI)) < 1e-12);
  assert.equal(p.stamp?.depth, 1);
  assert.deepEqual(parseSeal(JSON.parse(JSON.stringify(p))), p);
});

test('parseSeal rejects garbage', () => {
  const ok = JSON.parse(JSON.stringify(FULL));
  const bad: unknown[] = [
    undefined,
    null,
    5,
    'seal',
    [],
    [ok],
    {},
    { ...ok, v: 2 },
    { ...ok, v: '1' },
    { ...ok, x: Number.NaN },
    { ...ok, x: Infinity },
    { ...ok, x: '0.3' },
    { ...ok, x: 3 },
    { ...ok, y: -2 },
    { ...ok, rMm: 500 },
    { ...ok, rMm: 0 },
    { ...ok, rMm: null },
    { ...ok, stamp: 5 },
    { ...ok, stamp: [] },
    { ...ok, stamp: { ...ok.stamp, x: 'a' } },
    { ...ok, stamp: { ...ok.stamp, rMm: 90 } },
    { ...ok, stamp: { ...ok.stamp, rot: Number.NaN } },
    { ...ok, stamp: { ...ok.stamp, depth: undefined } },
    { ...ok, stretch: 'up' },
    { ...ok, stretch: [0.1, 0.1, 0.1] },
    { ...ok, stretch: [5, 0] },
    { ...ok, drops: 'many' },
    {
      ...ok,
      drops: [
        [0.1, 0.1, 1],
        [0.2, 0.2, 1],
        [0.3, 0.3, 1],
      ],
    },
    { ...ok, drops: new Array(1000).fill([0.5, 0.5, 1]) },
    { ...ok, drops: [[0.1, 0.1]] },
    { ...ok, drops: [{ x: 0.1, y: 0.1, r: 1 }] },
    { ...ok, drops: [[0.1, 0.1, 50]] },
  ];
  for (const b of bad) assert.equal(parseSeal(b), null, JSON.stringify(b));
  // A legacy row: no seal at all.
  assert.equal(parseSeal(undefined), null);
});

test('parseSeal clamps plausible values and ignores unknown keys', () => {
  const p = parseSeal({
    v: 1,
    x: 1.2,
    y: -0.1,
    rMm: 25,
    stamp: { x: 0.5, y: 0.5, rMm: 20, rot: 4, depth: 0.1 },
    stretch: [0.405, 0],
    extra: 'x',
  });
  assert.ok(p);
  assert.equal(p.x, 1);
  assert.equal(p.y, 0);
  assert.equal(p.rMm, 20);
  assert.equal(p.stamp?.rMm, 16);
  assert.equal(p.stamp?.depth, 0.35);
  assert.ok(Math.abs((p.stamp?.rot ?? 0) - (4 - 2 * Math.PI)) < 1e-12);
  assert.ok(Math.abs(Math.hypot(...p.stretch!) - 0.4) < 1e-12);
  assert.equal('extra' in p, false);
  // A missing stamp is wax only; zero stretch and empty drops are dropped.
  assert.deepEqual(parseSeal({ v: 1, x: 0.5, y: 0.5, rMm: 10, stretch: [0, 0], drops: [] }), {
    v: 1,
    x: 0.5,
    y: 0.5,
    rMm: 10,
    stamp: null,
  });
});

test('parseDie falls back to the monogram', () => {
  for (const d of SEAL_DIE_ORDER) assert.equal(parseDie(d), d);
  for (const b of [undefined, null, 5, '', 'pahonia', 'toString', '__proto__', 'constructor', { die: 'lily' }])
    assert.equal(parseDie(b), 'monogram');
});

test('every die has both labels and a drawing', () => {
  assert.deepEqual([...SEAL_DIE_ORDER].sort(), Object.keys(SEAL_DIES).sort());
  for (const d of SEAL_DIE_ORDER) {
    const spec = SEAL_DIES[d];
    assert.ok(spec.label.length > 0 && spec.labelFr.length > 0, d);
    assert.ok(spec.paths.length >= (d === 'monogram' ? 1 : 2), d);
    for (const p of spec.paths) assert.match(p.d, /^M[\d.\s-]/);
  }
});

test('the flap edge follows the rounded V', () => {
  for (const format of FORMATS) {
    for (const seed of SEEDS) {
      const g = flapGeo(format, seed);
      assert.equal(edgeYAt(g, 0), 0);
      assert.equal(edgeYAt(g, g.width), 0);
      assert.equal(edgeYAt(g, -5), 0);
      // Straight far from the tip.
      const x = g.width * 0.2;
      assert.ok(Math.abs(edgeYAt(g, x) - (g.flapTip * x) / g.tip.x) < 1e-9);
      // Rounded off at the tip: a little short of it, and the highest point is near it.
      const atTip = edgeYAt(g, g.tip.x);
      assert.ok(atTip < g.flapTip && atTip > g.flapTip - g.height * TIP_ROUND, `${atTip}`);
      // Continuous: no step where the straight edges meet the curve.
      let prev = edgeYAt(g, 0);
      for (let i = 1; i <= 2000; i++) {
        const y = edgeYAt(g, (i / 2000) * g.width);
        assert.ok(Math.abs(y - prev) < 0.2, `step at ${i}`);
        prev = y;
      }
    }
  }
});

test('sealHold: on the tip and on a V edge it holds, elsewhere it is decoration or rides the flap', () => {
  for (const format of FORMATS) {
    for (const seed of SEEDS) {
      const at = `${format} ${seed}`;
      assert.equal(sealHold(defaultSeal(format, seed), format, seed), 'straddle', `tip ${at}`);
      assert.equal(sealHold(presetSeal('left', format, seed), format, seed), 'straddle', `left edge ${at}`);
      assert.equal(sealHold(presetSeal('flap', format, seed), format, seed), 'flap', `flap ${at}`);
      assert.equal(sealHold(presetSeal('body', format, seed), format, seed), 'body', `body ${at}`);
      // A small seal deep on the flap, near a corner.
      assert.equal(sealHold({ v: 1, x: 0.12, y: 0.04, rMm: 4, stamp: null }, format, seed), 'flap', `corner ${at}`);
      // Mostly below the right edge, but a quarter of it over: still holds.
      const tip = tipFraction(seed);
      const ex = 0.75;
      const ey = (FLAP_TIP * (1 - ex)) / (1 - tip);
      const mm = ENVELOPE_MM[format];
      assert.equal(
        sealHold({ v: 1, x: ex, y: ey + 6 / mm.h, rMm: 14, stamp: null }, format, seed),
        'straddle',
        `right edge ${at}`,
      );
      assert.equal(
        sealHold({ v: 1, x: ex, y: ey + 30 / mm.h, rMm: 10, stamp: null }, format, seed),
        'body',
        `below right edge ${at}`,
      );
    }
  }
});

const px = (p: SealPlacement, format: EnvelopeFormat = 'DL', w = 340) => {
  const h = Math.round((w * ENVELOPE_MM[format].h) / ENVELOPE_MM[format].w);
  return sealToPx(p, w, h, format, 1407);
};

test('pressTouches: on the wax, overhanging it, and a miss', () => {
  const s = px({ v: 1, x: 0.5, y: 0.5, rMm: 12, stamp: null });
  const dieR = DIE_R_MM * pxPerMm(340, 170, 'DL');
  assert.equal(pressTouches(s), false, 'no die, no press');
  assert.equal(pressTouches(s, { x: s.x, y: s.y, r: dieR }), true);
  assert.equal(pressTouches(s, { x: s.x + s.r, y: s.y, r: dieR }), true, 'overhang still touches');
  assert.equal(pressTouches(s, { x: s.x, y: s.y - s.r - dieR * 0.5, r: dieR }), true, 'half off the top edge');
  assert.equal(pressTouches(s, { x: s.x + s.r * 1.2 + dieR + 4, y: s.y, r: dieR }), false, 'beside the wax');
  assert.equal(pressTouches(s, { x: s.x + 200, y: s.y, r: dieR }), false);
  assert.equal(pressTouches(px(FULL)), true);
});

test('the wax shape: centre, edge, press spread, drops', () => {
  const plain = px({ v: 1, x: 0.5, y: 0.5, rMm: 12, stamp: null });
  assert.ok(inWax(plain, plain.x, plain.y));
  assert.ok(!inWax(plain, plain.x + plain.r * 1.3, plain.y));
  assert.ok(Math.abs(coverSD(plain, plain.x, plain.y) - plain.r) < plain.r * 0.15);
  // Pressing pushes wax out (the 7 % growth now lives in coverSD and the shader).
  const pressed: SealPx = { ...plain, stamp: { x: plain.x, y: plain.y, r: plain.r * 0.8, angle: 0, depth: 1 } };
  const edge = plain.x + plain.r * 1.03;
  assert.ok(coverSD(pressed, edge, plain.y) > coverSD(plain, edge, plain.y));
  // A drop is wax too.
  const s = px(FULL);
  for (const [dx, dy] of s.drops) assert.ok(inWax(s, dx, dy));
});

test('bounds hold the whole outline, the drops and the die', () => {
  for (const p of [
    FULL,
    defaultSeal('DL', 7),
    presetSeal('left', 'C5', 1),
    { ...FULL, stamp: { ...FULL.stamp!, x: 0.36, y: 0.3 } },
  ]) {
    const s = px(p);
    const b = sealBounds(s);
    assert.equal(b.maxX - b.minX, b.width);
    assert.equal(b.maxY - b.minY, b.height);
    const o = outline(s);
    assert.equal(o.length, 96 * 2);
    for (let i = 0; i < o.length; i += 2) {
      assert.ok(o[i] > b.minX && o[i] < b.maxX && o[i + 1] > b.minY && o[i + 1] < b.maxY, 'outline in bounds');
      // On the edge: wax just inside, none just outside.
      const dx = o[i] - s.x;
      const dy = o[i + 1] - s.y;
      const d = Math.hypot(dx, dy) || 1;
      assert.ok(coverSD(s, o[i] + (dx / d) * 0.3, o[i + 1] + (dy / d) * 0.3) <= 0.05);
    }
    for (const [dx, dy, dr] of s.drops) assert.ok(dx - dr > b.minX && dx + dr < b.maxX && dy - dr > b.minY && dy + dr < b.maxY);
    if (s.stamp) assert.ok(s.stamp.x - s.stamp.r > b.minX && s.stamp.x + s.stamp.r < b.maxX);
  }
});

test('the transit crack crosses the wax through the die and stays on it', () => {
  for (const p of [FULL, defaultSeal('DL', 1407), presetSeal('body', 'C6', 7)]) {
    const s = px(p);
    const c = sealCrack(s, 1407);
    assert.equal(c.length, 16);
    for (let i = 0; i < c.length; i += 2) assert.ok(coverSD(s, c[i], c[i + 1]) > -s.r * 0.12, 'on the wax');
    assert.deepEqual(sealCrack(s, 1407), c, 'seeded');
    assert.notDeepEqual(sealCrack(s, 7), c);
    const span = Math.hypot(c[0] - c[14], c[1] - c[15]);
    assert.ok(span > s.r * 1.2, `spans the seal (${span} vs r ${s.r})`);
  }
});

test('a die hanging off the puddle: the crack still runs through the wax, never on bare paper', () => {
  for (const format of ['DL', 'C5'] as EnvelopeFormat[]) {
    for (const kx of [0.58, 0.6, 0.62]) {
      const p = sealFromParams({ sx: 0.5, sy: 0.5, kx, ky: 0.5 }, format, 1407)!;
      const s = px(p, format);
      assert.ok(pressTouches(s), `${format} kx ${kx}: a valid press`);
      const c = sealCrack(s, 1407);
      for (let i = 0; i < c.length; i += 2)
        assert.ok(coverSD(s, c[i], c[i + 1]) > 0, `${format} kx ${kx}: vertex ${i / 2} on the wax`);
      const span = Math.hypot(c[0] - c[c.length - 2], c[1] - c[c.length - 1]);
      assert.ok(span >= s.r * 0.8, `${format} kx ${kx}: spans the seal (${span.toFixed(1)} vs r ${s.r.toFixed(1)})`);
    }
  }
});

test('a non-numeric seed never makes a NaN seal', () => {
  const s = { ...px(FULL), seed: 'abc' as unknown as number };
  assert.ok(Number.isFinite(coverSD(s, s.x, s.y)), 'coverSD');
  assert.ok(outline(s).every(Number.isFinite), 'outline');
});

test('sealHold: wax over the flap tip holds, however low the puddle sits', () => {
  // Low on the tip: the tip and both V edges are under the wax, but most of it is on the body.
  for (const sy of [0.6, 0.62])
    assert.equal(sealHold(sealFromParams({ sx: 0.5, sy }, 'DL', 1407)!, 'DL', 1407), 'straddle', `sy ${sy}`);
  assert.equal(sealHold(sealFromParams({ sx: 0.5, sy: 0.7 }, 'DL', 1407)!, 'DL', 1407), 'body');
  // A tiny seal still needs a fifth of itself on each side, not 40 mm² it doesn't have.
  const g = flapGeo('DL', 1407);
  const tipY = edgeYAt(g, g.tip.x) / 110;
  assert.equal(sealHold({ v: 1, x: g.tip.x / 220, y: tipY, rMm: 3, stamp: null }, 'DL', 1407), 'straddle', 'tiny on the tip');
});

test('depth from cooling and the puddle clamp', () => {
  assert.equal(pressDepth(0), 1);
  assert.equal(pressDepth(0.39), 1);
  assert.ok(Math.abs(pressDepth(1) - 0.35) < 1e-12);
  assert.ok(Math.abs(pressDepth(2) - 0.35) < 1e-12);
  assert.ok(pressDepth(0.7) < 1 && pressDepth(0.7) > 0.35);
  const k = pxPerMm(340, 170, 'DL');
  const r = 12 * k;
  const c = clampPuddleCentre(0, 500, r, 340, 170, k);
  assert.ok(Math.abs(c.x - (r * 1.15 + 2 * k)) < 1e-9);
  assert.ok(Math.abs(c.y - (170 - r * 1.15 - 2 * k)) < 1e-9);
  assert.deepEqual(clampPuddleCentre(100, 80, r, 340, 170, k), { x: 100, y: 80 });
});

test('QA params build placements, and none leaves the default path', () => {
  assert.equal(sealFromParams({}, 'DL', 1407), undefined);
  assert.equal(sealFromParams({ hold: 'nonsense' }, 'DL', 1407), undefined);
  assert.deepEqual(sealFromParams({ hold: 'tip' }, 'DL', 1407), defaultSeal('DL', 1407));
  assert.deepEqual(sealFromParams({ hold: 'flap' }, 'C5', 7), presetSeal('flap', 'C5', 7));
  const p = sealFromParams({ sx: 0.3, sy: 0.32, kx: 0.31, ky: 0.33, rot: 0.4, depth: 0.4 }, 'DL', 1407);
  assert.ok(p?.stamp);
  assert.deepEqual([p.x, p.y, p.stamp.x, p.stamp.y, p.stamp.rot, p.stamp.depth], [0.3, 0.32, 0.31, 0.33, 0.4, 0.4]);
  // Moving the puddle alone carries the die with it.
  const q = sealFromParams({ sx: 0.7, sy: 0.6 }, 'DL', 1407);
  assert.deepEqual([q?.stamp?.x, q?.stamp?.y], [0.7, 0.6]);
});

test('the sealed draft becomes letters.envelope', () => {
  const e: DraftEnvelope = {
    paper: 'kraft',
    liner: 'postal',
    wax: 'navy',
    waxType: 'flexible',
    die: 'swallow',
    initials: 'Н',
    seed: 1407,
    format: 'C5',
    seal: FULL,
  };
  const json = envelopeJson(e);
  assert.deepEqual(json, { ...e });
  assert.deepEqual(parseSeal(JSON.parse(JSON.stringify(json)).seal), FULL);
  assert.equal(getLastDie(), null);
  setLastDie('lily');
  assert.equal(getLastDie(), 'lily');
});

test('edgeYAt is the edge of the flap path envelope.ts draws', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const init = require('canvaskit-wasm/bin/full/canvaskit.js');
  const CK = await init({ locateFile: (f: string) => require.resolve(`canvaskit-wasm/bin/full/${f}`) });
  for (const format of FORMATS) {
    for (const seed of SEEDS) {
      const w = 340;
      const h = Math.round((w * ENVELOPE_MM[format].h) / ENVELOPE_MM[format].w);
      const g = flapGeo(format, seed, w, h);
      // envelope.ts's roundedTriangle([0, 0], tip, [w, 0], h * TIP_ROUND).
      const r = h * TIP_ROUND;
      const toward = (px: number, py: number) => {
        const len = Math.hypot(g.tip.x - px, g.tip.y - py);
        const k = Math.max(0, (len - r) / len);
        return [px + (g.tip.x - px) * k, py + (g.tip.y - py) * k];
      };
      const [p1x, p1y] = toward(0, 0);
      const [p2x, p2y] = toward(w, 0);
      const path = new CK.PathBuilder()
        .moveTo(0, 0)
        .lineTo(p1x, p1y)
        .quadTo(g.tip.x, g.tip.y, p2x, p2y)
        .lineTo(w, 0)
        .close()
        .detachAndDelete();
      for (let i = 1; i < 200; i++) {
        const x = (i / 200) * w;
        const y = edgeYAt(g, x);
        if (y > 0.5) assert.ok(path.contains(x, y - 0.05), `above the edge is flap (${format} ${seed} x ${x})`);
        assert.ok(!path.contains(x, y + 0.05), `below the edge is body (${format} ${seed} x ${x})`);
      }
      path.delete();
    }
  }
});
