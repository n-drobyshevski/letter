import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_TILT, gripOf } from '../src/letter/grip';

/** How the hand takes the sheet shapes the turn (DeskStack). */

test('taken mid-edge and pulled straight across: a plain book-page turn', () => {
  assert.equal(gripOf(1, -120, 0, 0.5).tilt, 0);
  assert.equal(gripOf(-1, 120, 0, 0.5).tilt, 0);
  assert.deepEqual([gripOf(1, -120, 0, 0.5).ux, gripOf(1, -120, 0, 0.5).uy], [-1, 0]);
});

test('the axis leans square to the drag and toward where the edge was taken, mirrored for the way back', () => {
  // Pulled up and to the left, or taken near the top of the right edge: opposite leans.
  assert.ok(gripOf(1, -120, -80, 0.5).tilt > 0);
  assert.ok(gripOf(1, -120, 0, 0.05).tilt < 0);
  // The way back mirrors it.
  assert.ok(Math.abs(gripOf(-1, 120, -80, 0.5).tilt + gripOf(1, -120, -80, 0.5).tilt) < 1e-9);
  assert.ok(Math.abs(gripOf(-1, 120, 0, 0.05).tilt + gripOf(1, -120, 0, 0.05).tilt) < 1e-9);
  // Never past the limit, however steep.
  assert.equal(gripOf(1, -10, -400, 1).tilt, MAX_TILT);
  assert.equal(gripOf(1, -10, 400, 0).tilt, -MAX_TILT);
});

test('whatever the lean, the turned face lands as the plain book-page mirror (so it reads upright)', () => {
  // DeskStack's flip at the end: rotate(tilt − 2·tilt) · rotateY(π) · rotate(−tilt).
  const R = (a: number) => [Math.cos(a), -Math.sin(a), Math.sin(a), Math.cos(a)];
  const M = [-1, 0, 0, 1];
  const mul = (a: number[], b: number[]) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]];
  for (const tilt of [-MAX_TILT, -0.2, 0, 0.13, MAX_TILT]) {
    const end = mul(mul(R(tilt - 2 * tilt), M), R(-tilt));
    end.forEach((v, i) => assert.ok(Math.abs(v - M[i]) < 1e-9, `tilt ${tilt}`));
  }
});
