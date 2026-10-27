import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HOME, PLACE_LIMIT, dragPlacement } from '../src/letter/deskMove';

/** A sheet pushed about the desk with the mouse. */

const size = { width: 400, height: 566 };

test('taken at its centre it slides without turning', () => {
  const p = dragPlacement(HOME, { x: 0, y: 0 }, { x: 40, y: -25 }, size);
  assert.deepEqual(p, { x: 40, y: -25, rot: 0 });
});

test('taken off-centre it turns the way the pull twists it', () => {
  // By the right edge, pulled down: clockwise (positive on a y-down screen); pulled up: the other way.
  assert.ok(dragPlacement(HOME, { x: 190, y: 0 }, { x: 0, y: 60 }, size).rot > 0);
  assert.ok(dragPlacement(HOME, { x: 190, y: 0 }, { x: 0, y: -60 }, size).rot < 0);
  // By the top edge, pulled right: clockwise too.
  assert.ok(dragPlacement(HOME, { x: 0, y: -270 }, { x: 60, y: 0 }, size).rot > 0);
});

test('it never wanders off the desk or spins round', () => {
  const far = dragPlacement(HOME, { x: 190, y: 270 }, { x: 5000, y: -5000 }, size);
  assert.equal(far.x, size.width * PLACE_LIMIT.x);
  assert.equal(far.y, -size.height * PLACE_LIMIT.y);
  assert.ok(Math.abs(far.rot) <= PLACE_LIMIT.rot);
});

test('a second push starts from where the first left it', () => {
  const once = dragPlacement(HOME, { x: 0, y: 0 }, { x: 30, y: 10 }, size);
  const twice = dragPlacement(once, { x: 0, y: 0 }, { x: 20, y: 5 }, size);
  assert.deepEqual(twice, { x: 50, y: 15, rot: 0 });
});
