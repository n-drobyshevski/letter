import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Geometry check without Skia: the pocket flaps (sides + bottom) plus the closed
 * flap must cover the whole envelope back, or the inside shows through as a line.
 * Mirrors the triangles in src/letter/envelope.ts (tips only; rounding is covered by the flap).
 */
type P = [number, number];
const inTri = ([x, y]: P, a: P, b: P, c: P) => {
  const s = (p: P, q: P, r: P) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = s([x, y], a, b);
  const d2 = s([x, y], b, c);
  const d3 = s([x, y], c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

test('a closed envelope back has no uncovered gaps', () => {
  const w = 1;
  const h = 0.5;
  const flap: [P, P, P] = [[0, 0], [w / 2, h * 0.56], [w, 0]];
  const left: [P, P, P] = [[0, 0], [w * 0.45, h * 0.42], [0, h]];
  const right: [P, P, P] = [[w, 0], [w * 0.55, h * 0.42], [w, h]];
  const bottom: [P, P, P] = [[0, h], [w / 2, h * 0.3], [w, h]];
  const gaps: P[] = [];
  for (let i = 1; i < 200; i++) {
    for (let j = 1; j < 100; j++) {
      const p: P = [(i / 200) * w, (j / 100) * h];
      if (![flap, left, right, bottom].some((t) => inTri(p, ...t))) gaps.push(p);
    }
  }
  assert.deepEqual(gaps.slice(0, 5), [], `${gaps.length} uncovered points`);
});
