import { test } from 'node:test';
import assert from 'node:assert/strict';

import { breakGeometry, crumbAt, crumbLandsAt, crumbLandsOn, crumbs, fibreTears, residueFibres } from '../src/letter/sealBreak';
import { coverSD, edgeYAt, flapGeo, inWax, presetSeal, sealHold, sealToPx, type SealPx } from '../src/letter/seal';

// Same proportions as envelopeGeometry(340): height 170, flap tip at 0.56 h, seal radius 0.17 h.
const g = { width: 340, height: 170, flapTip: 95.2, tip: { x: 170, y: 95.2 } };
const wax = (x: number, y: number, r = 28.9, seed = 1407): SealPx => ({
  x,
  y,
  r,
  stretch: [0, 0],
  drops: [],
  stamp: { x, y, r: r * 0.72, angle: 0, depth: 1 },
  seed,
});
const tipSeal = wax(170, 95.2 - 28.9 * 0.2);

/** The flap piece's points that lie on the paper edge (not displaced by the break). */
const offEdge = (piece: number[]) => {
  let worst = 0;
  for (let i = 0; i < piece.length; i += 2) worst = Math.max(worst, Math.abs(piece[i + 1] - edgeYAt(g, piece[i])));
  return worst;
};

test('the break runs through the wax and nowhere else', () => {
  const { crack, flapPiece } = breakGeometry(g, tipSeal, 1407);
  assert.ok(crack.length >= 20, 'a real crack, not a dot');
  for (let i = 0; i < crack.length; i += 2) {
    assert.ok(coverSD(tipSeal, crack[i], crack[i + 1]) > -0.2 * tipSeal.r, 'crack stays on the seal');
  }
  // Far from the seal the flap piece follows the paper edge (with its rounded tip) exactly.
  for (let i = 0; i < flapPiece.length; i += 2) {
    const [x, y] = [flapPiece[i], flapPiece[i + 1]];
    if (Math.hypot(x - tipSeal.x, y - tipSeal.y) > tipSeal.r * 1.6) assert.ok(Math.abs(y - edgeYAt(g, x)) < 1e-9);
  }
  const ys = flapPiece.filter((_, i) => i % 2 === 1);
  assert.equal(Math.min(...ys), 0);
  assert.ok(Math.max(...ys) < g.flapTip + 4);
  assert.deepEqual(flapPiece.slice(0, 2), [0, 0]);
  assert.deepEqual(flapPiece.slice(-2), [g.width, 0]);
  assert.deepEqual(breakGeometry(g, tipSeal, 1407), breakGeometry(g, tipSeal, 1407), 'seeded');
  assert.notDeepEqual(breakGeometry(g, tipSeal, 1407).crack, breakGeometry(g, tipSeal, 7).crack);
});

test('a seal on the left V edge breaks along that edge', () => {
  const x = 0.3 * g.width;
  const s = wax(x, edgeYAt(g, x));
  const { crack, flapPiece } = breakGeometry(g, s, 1407);
  assert.ok(crack.length >= 20, 'a real crack');
  for (let i = 0; i < crack.length; i += 2) {
    assert.ok(crack[i] < g.tip.x, 'on the left edge');
    assert.ok(Math.abs(crack[i + 1] - edgeYAt(g, crack[i])) < s.r * 0.25, 'along the flap edge');
    assert.ok(coverSD(s, crack[i], crack[i + 1]) > -0.2 * s.r, 'through the wax');
  }
  // The jag is there: the break leaves the straight paper edge.
  assert.ok(offEdge(flapPiece) > 0.5);
  // The right edge and the tip are untouched.
  for (let i = 0; i < flapPiece.length; i += 2) {
    if (flapPiece[i] > x + s.r * 1.6) assert.ok(Math.abs(flapPiece[i + 1] - edgeYAt(g, flapPiece[i])) < 1e-9);
  }
});

test('the jag scales with the seal', () => {
  const x = 0.75 * g.width;
  const big = breakGeometry(g, wax(x, edgeYAt(g, x), 28.9), 1407);
  const small = breakGeometry(g, wax(x, edgeYAt(g, x), 12), 1407);
  assert.ok(small.crack.length >= 16, 'a small seal still gets a ragged crack');
  assert.ok(offEdge(small.flapPiece) < offEdge(big.flapPiece));
});

test('a seal wholly on the flap or the body has no crack', () => {
  for (const s of [wax(g.tip.x, 0.2 * g.height), wax(0.5 * g.width, 0.8 * g.height)]) {
    const { crack, flapPiece } = breakGeometry(g, s, 1407);
    assert.deepEqual(crack, []);
    assert.equal(offEdge(flapPiece), 0, 'the flap piece is the plain flap');
  }
});

test('the presets break where sealHold says they hold', () => {
  for (const format of ['DL', 'C5', 'C6'] as const) {
    const fg = flapGeo(format, 1407, 340, format === 'DL' ? 170 : format === 'C5' ? 240.5 : 239.3);
    for (const preset of ['tip', 'left', 'flap', 'body'] as const) {
      const p = presetSeal(preset, format, 1407);
      const s = sealToPx(p, fg.width, fg.height, format, 1407);
      const { crack } = breakGeometry(fg, s, 1407);
      const hold = sealHold(p, format, 1407);
      assert.equal(crack.length > 0, hold === 'straddle', `${format} ${preset}: ${hold}`);
    }
  }
});

test('crumbs fly up first, then land and stay', () => {
  const { crack } = breakGeometry(g, tipSeal, 1407);
  for (const c of crumbs(crack, 1407)) {
    assert.ok(crumbAt(c, 0.05).y < c.y, 'thrown upwards');
    const late = crumbAt(c, 1.5);
    assert.equal(late.y, c.y + c.land, 'resting where it landed');
    assert.deepEqual(crumbAt(c, 2), { ...crumbAt(c, 2) });
    // Down means down: no sliding on after landing (a skid of a few % at most).
    const tl = crumbLandsAt(c);
    const atLanding = crumbAt(c, tl).x;
    assert.ok(Math.abs(crumbAt(c, 0.7).x - atLanding) <= Math.abs(c.vx) * 0.04 + 1e-9, 'stops where it lands');
    assert.ok(Math.abs(crumbAt(c, 0.7).x - crumbAt(c, 1.5).x) < 0.5, 'and stays');
    // Off the paper it falls on past where it would have landed.
    assert.ok(crumbAt(c, 0.7, true).y > c.y + c.land);
  }
});

test('a crumb that lands past the envelope edge is off the paper', () => {
  const { crack } = breakGeometry(g, tipSeal, 1407);
  const all = crumbs(crack, 1407);
  const rect = { x: 0, y: 0, width: g.width, height: g.height };
  assert.ok(all.every((c) => crumbLandsOn(c, rect)), 'a seal on the tip keeps its crumbs');
  const narrow = { x: tipSeal.x - 1, y: 0, width: 2, height: g.height };
  assert.ok(all.every((c) => !crumbLandsOn(c, narrow)), 'thrown sideways past a 2 pt strip');
});

test('torn fibres cover 30–60 % of the glued edges, from the real tip', () => {
  for (const tipX of [170, 176]) {
    const gg = { ...g, tip: { x: tipX, y: g.flapTip } };
    const segs = fibreTears(gg, 1407);
    const edge = Math.hypot(tipX, g.flapTip) + Math.hypot(g.width - tipX, g.flapTip);
    const torn = segs.reduce((s, [x0, y0, x1, y1]) => s + Math.hypot(x1 - x0, y1 - y0), 0);
    assert.ok(torn / edge > 0.3 && torn / edge < 0.6, `covered ${(torn / edge).toFixed(2)}`);
    for (const [x0, y0] of segs) {
      const onLine = x0 <= tipX ? (g.flapTip * x0) / tipX : (g.flapTip * (g.width - x0)) / (g.width - tipX);
      assert.ok(Math.abs(y0 - onLine) < 1e-9, 'on the glued edge');
    }
  }
});

test('flexible wax leaves fibres only where it sat on the body', () => {
  const x = 0.3 * g.width;
  for (const s of [tipSeal, wax(x, edgeYAt(g, x))]) {
    const segs = residueFibres(g, s, 1407);
    assert.equal(segs.length, 9);
    for (const [x0, y0] of segs) {
      assert.ok(inWax(s, x0, y0), 'inside the footprint');
      assert.ok(y0 > edgeYAt(g, x0), 'below the flap edge');
    }
  }
  assert.deepEqual(residueFibres(g, tipSeal, 1407), residueFibres(g, tipSeal, 1407), 'seeded');
  // Wholly on the flap: nothing touched the body.
  assert.deepEqual(residueFibres(g, wax(g.tip.x, 0.2 * g.height), 1407), []);
});
