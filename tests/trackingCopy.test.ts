import { test } from 'node:test';
import assert from 'node:assert/strict';

import { silenceLine, windowLine } from '../src/letter/tracking/copy';
import type { Itinerary, TrackingEvent } from '../src/letter/tracking/itinerary';

const it = (lo: string, hi: string) => ({ tier: 'postal', window: { lo, hi }, deliverAt: '2026-11-21T13:00:00Z' }) as Itinerary;

test('the promise reads naturally in both languages', () => {
  assert.equal(windowLine(it('2026-11-19', '2026-11-26'), 'ru', 'Europe/Minsk'), 'Придёт между 19 и 26 ноября');
  assert.equal(windowLine(it('2026-11-19', '2026-11-26'), 'fr', 'Europe/Minsk'), 'Arrivée entre le 19 et le 26 novembre');
  assert.equal(windowLine(it('2026-10-30', '2026-11-05'), 'ru', 'Europe/Minsk'), 'Придёт между 30 октября и 5 ноября');
});

test('silence is explained, with correct Russian plurals', () => {
  const last = { code: 'EMC', at: '2026-11-01T10:00:00Z' } as TrackingEvent;
  const at = (d: number) => Date.parse('2026-11-01T10:00:00Z') + d * 864e5 + 3600e3;
  assert.equal(silenceLine(last, at(0), 'ru'), null);
  assert.match(silenceLine(last, at(1), 'ru')!, /^Нет новостей 1 день/);
  assert.match(silenceLine(last, at(3), 'ru')!, /^Нет новостей 3 дня/);
  assert.match(silenceLine(last, at(5), 'ru')!, /^Нет новостей 5 дней/);
  assert.match(silenceLine(last, at(2), 'fr')!, /^Pas de nouvelles depuis 2 jours/);
  assert.equal(silenceLine({ code: 'EMI', at: last.at } as TrackingEvent, at(9), 'ru'), null);
});
