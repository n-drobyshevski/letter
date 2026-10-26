import { test } from 'node:test';
import assert from 'node:assert/strict';

import { breakGeometry, crumbAt, crumbs, fibreTears } from '../src/letter/sealBreak';

// Same proportions as envelopeGeometry(340): height 170, flap tip at 0.56 h, seal radius 0.17 h.
const g = { width: 340, flapTip: 95.2, seal: { x: 170, y: 95.2 - 28.9 * 0.2, maxR: 28.9 } };

test('the break runs through the wax and nowhere else', () => {
  const { crack, flapPiece } = breakGeometry(g, 1407);
  assert.ok(crack.length >= 20, 'a real crack, not a dot');
  for (let i = 0; i < crack.length; i += 2) {
    const d = Math.hypot(crack[i] - g.seal.x, crack[i + 1] - g.seal.y);
    assert.ok(d < g.seal.maxR * 1.15, 'crack stays inside the seal');
  }
  // Far from the seal the flap piece follows the paper edge exactly.
  const ys = flapPiece.filter((_, i) => i % 2 === 1);
  assert.equal(Math.min(...ys), 0);
  assert.ok(Math.max(...ys) < g.flapTip + 4);
  assert.deepEqual(breakGeometry(g, 1407), breakGeometry(g, 1407), 'seeded');
  assert.notDeepEqual(breakGeometry(g, 1407).crack, breakGeometry(g, 7).crack);
});

test('crumbs fly up first, then land and stay', () => {
  const { crack } = breakGeometry(g, 1407);
  for (const c of crumbs(crack, 1407)) {
    assert.ok(crumbAt(c, 0.05).y < c.y, 'thrown upwards');
    const late = crumbAt(c, 1.5);
    assert.equal(late.y, c.y + c.land, 'resting where it landed');
    assert.deepEqual(crumbAt(c, 2), { ...crumbAt(c, 2) });
  }
});

test('torn fibres cover 30–60 % of the glued edges', () => {
  const segs = fibreTears(g, 1407);
  const edge = 2 * Math.hypot(g.seal.x, g.flapTip);
  const torn = segs.reduce((s, [x0, y0, x1, y1]) => s + Math.hypot(x1 - x0, y1 - y0), 0);
  assert.ok(torn / edge > 0.3 && torn / edge < 0.6, `covered ${(torn / edge).toFixed(2)}`);
});

test('flexible wax leaves fibres only where it sat on the body', async () => {
  const { residueFibres } = await import('../src/letter/sealBreak');
  const segs = residueFibres(g, 1407);
  assert.equal(segs.length, 9);
  for (const [x0, y0] of segs) {
    assert.ok(Math.hypot(x0 - g.seal.x, y0 - g.seal.y) <= g.seal.maxR, 'inside the footprint');
    assert.ok(y0 > g.flapTip * (1 - Math.abs(x0 - g.seal.x) / g.seal.x), 'below the flap edge');
  }
});
