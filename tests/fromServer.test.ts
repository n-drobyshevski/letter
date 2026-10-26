import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { itineraryFromServer, promiseLine, type EventRow, type LetterRow } from '../src/letter/tracking/fromServer';
import { generateItinerary, visibleAt } from '../src/letter/tracking/itinerary';

/** What the app reads back through RLS becomes the itinerary the map and the receipt draw. */

const collectAt = new Date('2026-10-27T14:30:00Z');
const it = generateItinerary({ seed: 1407, collectAt, tier: 'postal' });
const letter: LetterRow = {
  id: 'l1',
  tier: 'postal',
  sender_id: 'a',
  recipient_id: 'b',
  // As PostgREST prints timestamptz.
  collect_at: it.collectAt.replace('.000Z', '+00:00'),
  deliver_at: it.deliverAt.replace('.000Z', '+00:00'),
  retrieved_at: null,
  tracking: { route: it.route, s10: it.s10, window: it.window },
};
const day8 = new Date(collectAt.getTime() + 8 * 864e5);
// RLS: visible scans whose time has come, as rows.
const rows: EventRow[] = visibleAt(it, day8)
  .map((e) => ({ seq: e.seq, at: e.at, code: e.code, office: e.office, place: e.place, route_t: e.routeT, notify: e.notify }))
  .reverse();

describe('itineraryFromServer', () => {
  test('rebuilds the scans so far, in order, with the promise of the letter', () => {
    const got = itineraryFromServer(letter, rows)!;
    assert.equal(got.s10, it.s10);
    assert.equal(got.deliverAt, it.deliverAt);
    assert.equal(got.collectAt, it.collectAt);
    assert.deepEqual(got.window, it.window);
    assert.deepEqual(got.events, visibleAt(it, day8));
    // The components see exactly what the lab shows for the same moment.
    assert.deepEqual(visibleAt(got, day8), visibleAt(it, day8));
  });

  test('no tracking, no itinerary; the promise still reads', () => {
    const plain: LetterRow = { ...letter, tier: 'express', tracking: null, deliver_at: '2026-10-28T13:00:00+00:00' };
    assert.equal(itineraryFromServer(plain, []), null);
    assert.equal(promiseLine(plain, 'ru', 'Europe/Minsk'), 'Придёт 28 октября около 16:00');
    assert.equal(promiseLine(plain, 'fr', 'Europe/Paris'), 'Arrivée le 28 octobre vers 14 h 00');
    assert.match(promiseLine(letter, 'ru', 'Europe/Minsk'), /^Придёт (между|\d)/);
  });
});
