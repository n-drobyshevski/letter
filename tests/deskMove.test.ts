import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HOME, PLACE_LIMIT, deskBounds, dragPlacement, fanOut, nextPlacement, sheetAt } from '../src/letter/deskMove';

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

const area = { width: 1100, height: 614 };

test('on the loose desk a sheet may go further, but its centre stays on the desk', () => {
  const b = deskBounds(size, area);
  assert.ok(b.x > size.width * PLACE_LIMIT.x);
  const far = dragPlacement(HOME, { x: 0, y: 0 }, { x: 5000, y: 5000 }, size, b);
  assert.deepEqual([far.x, far.y], [b.x, b.y]);
  assert.ok(far.x < area.width / 2 + size.width / 2, 'never wholly off the desk');
});

test('the sheet under the pointer is the topmost one there, crooked sheets included', () => {
  const placements = [{ x: -200, y: 0, rot: 0 }, { x: 0, y: 0, rot: 0 }, { x: 300, y: 0, rot: 0.1 }];
  const c = (pl: { x: number; y: number }) => ({ x: area.width / 2 + pl.x, y: area.height / 2 + pl.y });
  // Where sheets 0 and 1 overlap, the one listed later (on top) wins.
  assert.equal(sheetAt(c({ x: -100, y: 0 }), placements, [0, 1, 2], size, area), 1);
  assert.equal(sheetAt(c({ x: -100, y: 0 }), placements, [1, 2, 0], size, area), 0);
  // Only sheet 0 reaches out there; nothing at the desk's far corner.
  assert.equal(sheetAt(c({ x: -390, y: 0 }), placements, [0, 1, 2], size, area), 0);
  assert.equal(sheetAt({ x: 2, y: 2 }, placements, [0, 1, 2], size, area), -1);
  // A turned sheet (sheet 2, 0.1 rad): just inside its turned corner is on it; the same spot unturned is not.
  const local = { x: 195, y: 278 };
  const onTurned = { x: 300 + local.x * Math.cos(0.1) - local.y * Math.sin(0.1), y: local.x * Math.sin(0.1) + local.y * Math.cos(0.1) };
  assert.equal(sheetAt(c(onTurned), placements, [2], size, area), 2);
  assert.equal(sheetAt(c({ x: 300 + local.x, y: local.y }), placements, [2], size, area), -1);
});

test('sheets already written are fanned out, the last in front; a new one lands offset on top', () => {
  const fan = fanOut(3, size, area, () => 0.05);
  assert.ok(fan[0].x < fan[1].x && fan[1].x < fan[2].x);
  assert.equal(fan[1].x, 0);
  assert.deepEqual(fanOut(1, size, area, () => 0.05), [{ x: 0, y: 0, rot: 0 }]);
  const next = nextPlacement(fan[2], size, area, 0.03);
  assert.ok(next.x > fan[2].x && next.y > fan[2].y);
  assert.ok(Math.abs(next.x) <= deskBounds(size, area).x);
});
