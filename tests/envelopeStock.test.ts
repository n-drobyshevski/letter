import { test } from 'node:test';
import assert from 'node:assert/strict';

import { envelopePickPatch, isEnvelopePaper } from '../src/lib/envelopeStock';
import { DEFAULT_STATIONERY_PICK, getStationeryPick, resetStationeryPick, setStationeryPick } from '../src/lib/stationeryPick';

/** /seal writes the envelope's paper and liner back to the pick (spec §4.3, WP-E). */

test('only cream and kraft are envelope stock', () => {
  assert.equal(isEnvelopePaper('cream'), true);
  assert.equal(isEnvelopePaper('kraft'), true);
  assert.equal(isEnvelopePaper('grid'), false);
  assert.equal(isEnvelopePaper('seyes'), false);
});

test('a paper or liner change becomes an envelope patch; wax, die and sheet papers do not', () => {
  assert.deepEqual(envelopePickPatch({ paper: 'kraft' }), { envelope: { paper: 'kraft' } });
  assert.deepEqual(envelopePickPatch({ liner: 'bordeaux' }), { envelope: { liner: 'bordeaux' } });
  assert.deepEqual(envelopePickPatch({ paper: 'cream', liner: 'forest' }), { envelope: { paper: 'cream', liner: 'forest' } });
  assert.equal(envelopePickPatch({}), undefined);
  assert.equal(envelopePickPatch({ wax: 'gold', die: 'rose' } as never), undefined);
  assert.equal(envelopePickPatch({ paper: 'cotton' }), undefined);
});

test('applied to the pick, it keeps the other half of the stock and the sheet look', () => {
  resetStationeryPick();
  setStationeryPick({ paper: 'seyes', ink: 'sapphire' });
  setStationeryPick(envelopePickPatch({ liner: 'bordeaux' })!);
  setStationeryPick(envelopePickPatch({ paper: 'kraft' })!);
  assert.deepEqual(getStationeryPick(), {
    ...DEFAULT_STATIONERY_PICK,
    paper: 'seyes',
    ink: 'sapphire',
    envelope: { paper: 'kraft', liner: 'bordeaux' },
  });
  resetStationeryPick();
});
