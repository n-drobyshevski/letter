import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HOME, PLACE_LIMIT, deskBounds, dragPlacement, fanOut, nextPlacement, sheetAt, sweep, twistPlacement, wrapAngle } from '../src/letter/deskMove';

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

test('a right-button drag turns a sheet round its centre to any angle, and it stays there', () => {
  // A quarter of the way round, clockwise on screen: +π/2.
  assert.ok(Math.abs(sweep({ x: 100, y: 0 }, { x: 0, y: 100 }) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(sweep({ x: 100, y: 0 }, { x: 0, y: -100 }) + Math.PI / 2) < 1e-9);
  // Next to the centre the angle means nothing.
  assert.equal(sweep({ x: 5, y: 0 }, { x: 0, y: 100 }), 0);
  // Summed over the steps of a drag it follows the hand all the way round.
  let rot = 0;
  let prev = { x: 100, y: 0 };
  for (let k = 1; k <= 36; k++) {
    const next = { x: 100 * Math.cos((k * Math.PI) / 12), y: 100 * Math.sin((k * Math.PI) / 12) };
    rot += sweep(prev, next);
    prev = next;
  }
  assert.ok(Math.abs(rot - 3 * Math.PI) < 1e-9);
  // The placement keeps its angle (wrapped) as its aim, and its place.
  const turned = twistPlacement({ x: 30, y: -10, rot: 0.1 }, 3);
  assert.equal(turned.x, 30);
  assert.equal(turned.y, -10);
  assert.ok(Math.abs(turned.rot - wrapAngle(3.1)) < 1e-9);
  assert.equal(turned.aim, turned.rot);
  assert.ok(turned.rot > -Math.PI && turned.rot <= Math.PI);
});

test('a sheet turned by hand, then pushed: a pull tilts it a few degrees off its own angle, not back to straight', () => {
  const size = { width: 380, height: 540 };
  const turned = twistPlacement(HOME, 0.8);
  const pushed = dragPlacement(turned, { x: 190, y: 0 }, { x: 0, y: 400 }, size);
  assert.equal(pushed.aim, turned.aim);
  assert.ok(pushed.rot > 0.8 && pushed.rot <= 0.8 + PLACE_LIMIT.rot + 1e-9);
  // Never turned by hand: no aim, as before.
  assert.equal('aim' in dragPlacement(HOME, { x: 0, y: 0 }, { x: 10, y: 0 }, size), false);
});
