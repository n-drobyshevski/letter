import { test } from 'node:test';
import assert from 'node:assert/strict';

import { slitCatches, slitEdge } from '../src/letter/tear';

test('the slit runs the full width, close to the fold, without tearing deep', () => {
  const pts = slitEdge(340, 1407);
  const xs = pts.filter((_, i) => i % 2 === 0);
  const ys = pts.filter((_, i) => i % 2 === 1);
  assert.equal(xs[0], 0);
  assert.equal(xs.at(-1), 340);
  for (const y of ys) assert.ok(y > 0.5 && y < 2.8, `y=${y} stays within ~2 pt of the fold`);
  assert.deepEqual(slitEdge(340, 1407), pts, 'seeded: both phones see the same cut');
});

test('fibre catches are spaced like stick-slip, never a buzz', () => {
  const c = slitCatches(340, 1407).map((f) => f * 340);
  assert.ok(c.length >= 10);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] - c[i - 1] >= 18 && c[i] - c[i - 1] <= 30);
});
