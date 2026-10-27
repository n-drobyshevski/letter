import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_STATIONERY_PICK,
  getStationeryPick,
  resetStationeryPick,
  setStationeryPick,
  subscribeStationeryPick,
} from '../src/lib/stationeryPick';

/** The session store the drawers write and /write, /seal and /post read (spec §4.3). */

test('starts at the look /write has always had: grid, blue-black, Bad Script, cream with the postal liner', () => {
  resetStationeryPick();
  assert.deepEqual(getStationeryPick(), {
    paper: 'grid',
    ink: 'blueBlack',
    font: 'badScript',
    envelope: { paper: 'cream', liner: 'postal' },
  });
  assert.equal(getStationeryPick(), DEFAULT_STATIONERY_PICK);
});

test('a patch changes only what it names, the envelope paper and liner each on their own', () => {
  resetStationeryPick();
  setStationeryPick({ paper: 'seyes' });
  assert.deepEqual(getStationeryPick(), { ...DEFAULT_STATIONERY_PICK, paper: 'seyes' });
  setStationeryPick({ ink: 'sapphire', font: 'marckScript' });
  setStationeryPick({ envelope: { liner: 'forest' } });
  assert.deepEqual(getStationeryPick(), {
    paper: 'seyes',
    ink: 'sapphire',
    font: 'marckScript',
    envelope: { paper: 'cream', liner: 'forest' },
  });
  setStationeryPick({ envelope: { paper: 'kraft', liner: undefined } });
  assert.deepEqual(getStationeryPick().envelope, { paper: 'kraft', liner: 'forest' });
  assert.deepEqual(DEFAULT_STATIONERY_PICK.envelope, { paper: 'cream', liner: 'postal' }, 'the defaults are never mutated');
  resetStationeryPick();
});

test('listeners hear every real change once, nothing for a no-op, nothing after unsubscribing', () => {
  resetStationeryPick();
  let calls = 0;
  const off = subscribeStationeryPick(() => calls++);
  setStationeryPick({ paper: 'cotton' });
  assert.equal(calls, 1);
  const before = getStationeryPick();
  setStationeryPick({ paper: 'cotton', envelope: { paper: 'cream' } });
  setStationeryPick({});
  assert.equal(calls, 1, 'the same values notify nobody');
  assert.equal(getStationeryPick(), before, 'and keep the same object (useSyncExternalStore)');
  setStationeryPick({ envelope: { paper: 'kraft', liner: 'bordeaux' } });
  assert.equal(calls, 2);
  resetStationeryPick();
  assert.equal(calls, 3);
  resetStationeryPick();
  assert.equal(calls, 3);
  off();
  setStationeryPick({ ink: 'violet' });
  assert.equal(calls, 3);
  resetStationeryPick();
});
