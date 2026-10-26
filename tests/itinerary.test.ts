import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estimatedRouteT, generateItinerary, local, routeLengthKm, s10, visibleAt, zoned } from '../src/letter/tracking/itinerary';

// Tuesday 27 Oct 2026, 15:30 in Lille (CET, winter time since 25 Oct).
const COLLECT = new Date(zoned(2026, 10, 27, 15.5, 'Europe/Paris'));
const DAY = 864e5;

test('time zones: wall clock in Paris and Minsk, across the DST change', () => {
  const t = zoned(2026, 10, 27, 15.5, 'Europe/Paris');
  assert.equal(new Date(t).toISOString(), '2026-10-27T14:30:00.000Z', 'CET = UTC+1');
  assert.equal(new Date(zoned(2026, 10, 20, 15.5, 'Europe/Paris')).toISOString(), '2026-10-20T13:30:00.000Z', 'CEST = UTC+2');
  const m = local(t, 'Europe/Minsk');
  assert.equal(`${m.h}:${m.mi}`, '17:30', 'Minsk is UTC+3 all year');
  assert.equal(local(t, 'Europe/Paris').wd, 2, 'Tuesday');
});

test('S10 numbers carry a valid check digit', () => {
  const n = s10(1407);
  assert.match(n, /^RR \d{3} \d{3} \d{3} FR$/);
  const d = n.replace(/\D/g, '');
  const w = [8, 6, 4, 2, 3, 5, 9, 7];
  const sum = [...d.slice(0, 8)].reduce((s, c, i) => s + Number(c) * w[i], 0);
  let c = 11 - (sum % 11);
  if (c === 10) c = 0;
  if (c === 11) c = 5;
  assert.equal(Number(d[8]), c);
});

test('the same seed gives the same journey; scans run in order', () => {
  const a = generateItinerary({ seed: 1407, collectAt: COLLECT, tier: 'postal' });
  assert.deepEqual(a, generateItinerary({ seed: 1407, collectAt: COLLECT, tier: 'postal' }));
  for (let i = 1; i < a.events.length; i++) assert.ok(a.events[i].at >= a.events[i - 1].at, 'chronological');
  const vis = a.events.filter((e) => e.visible);
  assert.equal(vis[0].code, 'EMA');
  assert.equal(vis.at(-1)!.code, 'EMI');
  assert.equal(a.events.filter((e) => e.code === 'EMA').length, 1);
  assert.equal(a.events.filter((e) => e.code === 'EMI').length, 1);
  assert.equal(a.deliverAt, vis.at(-1)!.at, 'delivery is the EMI scan');
  for (let i = 1; i < a.events.length; i++) assert.ok(a.events[i].routeT >= a.events[i - 1].routeT, 'never goes backwards');
});

test('post-office calendars: no levée on Sundays/holidays, no delivery on Sundays or Belarusian holidays', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const collect = new Date(COLLECT.getTime() + (seed % 14) * DAY + (seed % 5) * 3600e3);
    const it = generateItinerary({ seed, collectAt: collect, tier: 'postal' });
    const ema = local(Date.parse(it.events[0].at), 'Europe/Paris');
    assert.notEqual(ema.wd, 7, 'no Sunday levée');
    assert.notEqual(ema.key, '2026-11-11', 'no levée on 11 November');
    const emi = local(Date.parse(it.deliverAt), 'Europe/Minsk');
    assert.notEqual(emi.wd, 7, 'no Sunday delivery');
    assert.ok(!['2026-11-07', '2026-12-25', '2027-01-01', '2027-01-02', '2027-01-07'].includes(emi.key), `no delivery on ${emi.key}`);
    assert.ok([10, 16].includes(emi.h), 'on a delivery round');
    const emd = it.events.find((e) => e.code === 'EMD')!;
    const h = local(Date.parse(emd.at), 'Europe/Minsk').h;
    assert.ok(h >= 9 && h < 19, 'MINSK PI 2 scans during opening hours');
  }
});

test('the window shown at posting always contains the delivery day', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const it = generateItinerary({ seed, collectAt: COLLECT, tier: 'postal' });
    const day = local(Date.parse(it.deliverAt), 'Europe/Minsk').key;
    assert.ok(it.window.lo <= day && day <= it.window.hi, `${it.window.lo} ≤ ${day} ≤ ${it.window.hi}`);
  }
});

test('calibration: median ≈ 18 days, p95 within a month ("romantic" profile)', () => {
  const days = Array.from({ length: 400 }, (_, i) => {
    const it = generateItinerary({ seed: 1000 + i, collectAt: COLLECT, tier: 'postal' });
    return (Date.parse(it.deliverAt) - COLLECT.getTime()) / DAY;
  }).sort((a, b) => a - b);
  const q = (p: number) => days[Math.floor(p * (days.length - 1))];
  assert.ok(q(0.5) > 14 && q(0.5) < 22, `p50 ${q(0.5).toFixed(1)} d`);
  assert.ok(q(0.95) < 32, `p95 ${q(0.95).toFixed(1)} d`);
  assert.ok(q(0.05) > 9, `p05 ${q(0.05).toFixed(1)} d`);
});

test('border closures and customs happen, rarely', () => {
  let closed = 0;
  let customs = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const it = generateItinerary({ seed, collectAt: COLLECT, tier: 'postal' });
    if (it.events.some((e) => e.code === 'XBH')) closed++;
    if (it.events.some((e) => e.code === 'EDB')) customs++;
  }
  assert.ok(closed > 20 && closed < 110, `closed ${closed}/2000`);
  assert.ok(customs > 40 && customs < 130, `customs ${customs}/2000`);
});

test('standard and express replay the journey inside their promised window', () => {
  const deliverAt = new Date(COLLECT.getTime() + 2.2 * DAY);
  for (const tier of ['standard', 'express'] as const) {
    const it = generateItinerary({ seed: 7, collectAt: COLLECT, tier, deliverAt });
    assert.equal(it.deliverAt, deliverAt.toISOString());
    const vis = it.events.filter((e) => e.visible);
    assert.equal(vis[0].at, COLLECT.toISOString(), 'first scan at collection');
    assert.equal(vis.at(-1)!.at, deliverAt.toISOString(), 'last scan at delivery');
    for (const e of it.events) assert.ok(e.at >= vis[0].at && e.at <= vis.at(-1)!.at);
    for (let i = 1; i < vis.length; i++) assert.ok(Date.parse(vis[i].at) - Date.parse(vis[i - 1].at) >= 20 * 60000);
    if (tier === 'express') assert.deepEqual(vis.map((e) => e.code), ['EMA', 'EMD', 'EMI']);
  }
  // A very short promise still keeps first and last scan.
  const tight = generateItinerary({ seed: 7, collectAt: COLLECT, tier: 'standard', deliverAt: new Date(COLLECT.getTime() + 30 * 60000) });
  const v = tight.events.filter((e) => e.visible).map((e) => e.code);
  assert.equal(v[0], 'EMA');
  assert.equal(v.at(-1), 'EMI');
});

test('what a viewer sees at a moment, and where the letter probably is', () => {
  const it = generateItinerary({ seed: 1407, collectAt: COLLECT, tier: 'postal' });
  const mid = new Date((COLLECT.getTime() + Date.parse(it.deliverAt)) / 2);
  const seen = visibleAt(it, mid);
  assert.ok(seen.length >= 1 && seen.length < it.events.filter((e) => e.visible).length);
  const t = estimatedRouteT(it, mid);
  assert.ok(t > 0 && t < 1);
  assert.ok(t >= seen.at(-1)!.routeT, 'at or beyond the last scan');
  assert.equal(estimatedRouteT(it, new Date(it.deliverAt)), 1);
  const km = routeLengthKm();
  assert.ok(km > 2000 && km < 2400, `route ${km.toFixed(0)} km`);
});
