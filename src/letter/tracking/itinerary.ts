/**
 * Delivery itinerary generator: where a letter is, and when, on its way.
 *
 * SELF-CONTAINED ON PURPOSE (no imports): this exact file is copied to
 * supabase/functions/_shared/itinerary.ts (`npm run sync:shared`, checked by a test),
 * so the server and the app's lab generate identical itineraries.
 *
 * Route model (FR → BY), researched Oct 2026 — see docs/research/tracking-*.md:
 *   Lille street box → PIC Lille-Lesquin → Roissy international office of exchange
 *   → by road through Belgium, Germany, Poland (no scans) → border Kukuryki–Козловичи
 *   → MINSK PI 2 (ул. Вокзальная, 22; customs post open 09–18 daily)
 *   → local delivery office → the recipient's mailbox.
 * Inferred, not published by La Poste or Belpost; all of it is data below.
 *
 * Calibration is a product choice ("romantic"): median ≈ 18 days. Real-world reports
 * for France → Belarus run longer (≈ 25–35+ days); `scale` 1.6 approximates that.
 */

// ───────────────────────── types ─────────────────────────

export type Tier = 'postal' | 'standard' | 'express';

/** UPU event codes, plus two of our own: XBH (held at a closed border) and WPT (silent waypoint). */
export type EventCode = 'EMA' | 'EDD' | 'EMB' | 'EMC' | 'WPT' | 'XBH' | 'XBX' | 'EMD' | 'EDB' | 'EDC' | 'EMF' | 'EMG' | 'EMI';

export type Place = {
  name: { fr: string; ru: string };
  lat: number;
  lon: number;
  tz: string;
  country: 'fr' | 'be' | 'de' | 'pl' | 'by';
};

export type TrackingEvent = {
  seq: number;
  /** ISO timestamp (UTC). */
  at: string;
  code: EventCode;
  /** Office label as printed in real tracking (Latin capitals for exchange offices). */
  office: string | null;
  place: Place;
  /** Position along the route polyline, 0..1 by distance. */
  routeT: number;
  /** Real tracking would show it (silent legs are invisible but place the letter on the map). */
  visible: boolean;
  /** Worth a push (at most two per letter). */
  notify: boolean;
};

export type Itinerary = {
  route: string;
  tier: Tier;
  collectAt: string;
  deliverAt: string;
  /** Day window shown at posting, in the recipient's time zone (YYYY-MM-DD). deliverAt is always inside. */
  window: { lo: string; hi: string };
  /** Registered-letter number (S10, with a valid check digit). */
  s10: string;
  events: TrackingEvent[];
};

// ───────────────────────── route data ─────────────────────────

type Vertex = { lat: number; lon: number; name?: { fr: string; ru: string }; country: Place['country']; tz: string };

const PARIS = 'Europe/Paris';
const MINSK = 'Europe/Minsk';

/** Whether a sender → recipient pair (by time zone) has a route. Only France → Belarus so far. */
export function routed(fromTz: string | null | undefined, toTz: string | null | undefined): boolean {
  return fromTz === PARIS && toTz === MINSK;
}

/** Road polyline Lille → Minsk (vertices also used to place events on the map). */
export const FR_BY_POLYLINE: Vertex[] = [
  { lat: 50.637, lon: 3.063, name: { fr: 'Lille', ru: 'Лилль' }, country: 'fr', tz: PARIS },
  { lat: 50.585, lon: 3.115, name: { fr: 'Lesquin', ru: 'Лекен' }, country: 'fr', tz: PARIS },
  { lat: 49.005, lon: 2.56, name: { fr: 'Roissy-en-France', ru: 'Руасси' }, country: 'fr', tz: PARIS },
  { lat: 50.85, lon: 4.35, name: { fr: 'Bruxelles', ru: 'Брюссель' }, country: 'be', tz: 'Europe/Brussels' },
  { lat: 50.633, lon: 5.567, name: { fr: 'Liège', ru: 'Льеж' }, country: 'be', tz: 'Europe/Brussels' },
  { lat: 50.938, lon: 6.96, name: { fr: 'Cologne', ru: 'Кёльн' }, country: 'de', tz: 'Europe/Berlin' },
  { lat: 52.375, lon: 9.732, name: { fr: 'Hanovre', ru: 'Ганновер' }, country: 'de', tz: 'Europe/Berlin' },
  { lat: 52.52, lon: 13.405, name: { fr: 'Berlin', ru: 'Берлин' }, country: 'de', tz: 'Europe/Berlin' },
  { lat: 52.406, lon: 16.925, name: { fr: 'Poznań', ru: 'Познань' }, country: 'pl', tz: 'Europe/Warsaw' },
  { lat: 52.23, lon: 21.012, name: { fr: 'Varsovie', ru: 'Варшава' }, country: 'pl', tz: 'Europe/Warsaw' },
  { lat: 52.033, lon: 23.116, name: { fr: 'Biała Podlaska', ru: 'Бяла-Подляска' }, country: 'pl', tz: 'Europe/Warsaw' },
  { lat: 52.137, lon: 23.56, name: { fr: 'Kukuryki', ru: 'Кукурыки' }, country: 'pl', tz: 'Europe/Warsaw' },
  { lat: 52.122, lon: 23.69, name: { fr: 'Kozlovitchi', ru: 'Козловичи' }, country: 'by', tz: MINSK },
  { lat: 53.132, lon: 26.016, name: { fr: 'Baranovitchi', ru: 'Барановичи' }, country: 'by', tz: MINSK },
  { lat: 53.889, lon: 27.548, name: { fr: 'Minsk', ru: 'Минск' }, country: 'by', tz: MINSK },
  { lat: 53.905, lon: 27.56, name: { fr: 'Minsk', ru: 'Минск' }, country: 'by', tz: MINSK },
];

const V = {
  box: 0,
  pic: 1,
  roissy: 2,
  waypoints: [3, 5, 7, 9],
  borderPL: 11,
  borderBY: 12,
  exchange: 14,
  office: 15,
};

const OFFICES = {
  box: 'LILLE',
  pic: 'LESQUIN PIC',
  roissy: 'ROISSY COURRIER INTERNATIONAL',
  exchange: 'MINSK PI 2',
  office: 'ОПС МИНСК 220030',
};

/** Public holidays on which the post does not work (2026–27). */
const HOLIDAYS: Record<'fr' | 'by', string[]> = {
  fr: ['2026-11-01', '2026-11-11', '2026-12-25', '2027-01-01', '2027-03-29', '2027-05-01', '2027-05-06', '2027-05-08', '2027-05-17', '2027-07-14', '2027-08-15', '2027-11-01', '2027-11-11', '2027-12-25'],
  by: ['2026-11-07', '2026-12-25', '2027-01-01', '2027-01-02', '2027-01-07', '2027-03-08', '2027-05-01', '2027-05-09', '2027-05-11', '2027-07-03', '2027-11-07', '2027-12-25'],
};

// ───────────────────────── seeded randomness ─────────────────────────

/** Uniform in (0, 1), never 0 (safe for log), deterministic in (seed, key). */
export function uniform(seed: number, key: string): number {
  let h = 2166136261 ^ (seed >>> 0);
  const s = `${seed}:${key}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // mulberry32 finaliser
  let t = (h + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296;
}

function normal(seed: number, key: string): number {
  const u1 = uniform(seed, `${key}#a`);
  const u2 = uniform(seed, `${key}#b`);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** Dwell: median·exp(σ·z), z capped at p97 (no absurd tails). */
function lognormalHours(seed: number, key: string, medianH: number, sigma: number, scale: number): number {
  return medianH * scale * Math.exp(sigma * Math.min(normal(seed, key), 1.88)) * HOUR;
}

// ───────────────────────── time zones ─────────────────────────

type Local = { y: number; m: number; d: number; h: number; mi: number; wd: number; key: string };

const formats = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function local(ms: number, tz: string): Local {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    formats.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(ms))) p[part.type] = part.value;
  const y = Number(p.year);
  const m = Number(p.month);
  const d = Number(p.day);
  return { y, m, d, h: Number(p.hour) % 24, mi: Number(p.minute), wd: WEEKDAYS[p.weekday], key: `${p.year}-${p.month}-${p.day}` };
}

function offsetMs(ms: number, tz: string): number {
  const l = local(ms, tz);
  return Date.UTC(l.y, l.m - 1, l.d, l.h, l.mi) - Math.floor(ms / 60000) * 60000;
}

/** UTC instant of a wall-clock time in `tz` (DST-safe). */
export function zoned(y: number, m: number, d: number, hours: number, tz: string): number {
  const h = Math.floor(hours);
  const mi = Math.round((hours - h) * 60);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const o1 = offsetMs(guess, tz);
  let t = guess - o1;
  const o2 = offsetMs(t, tz);
  if (o2 !== o1) t = guess - o2;
  return t;
}

/** The first allowed slot at or after `after`. `slots(day)` lists allowed local hours (decimal) for that day. */
function nextSlot(after: number, tz: string, slots: (day: Local) => number[]): number {
  const start = local(after, tz);
  for (let i = 0; i < 60; i++) {
    // Calendar day i after the local start day (UTC date arithmetic, then read back in tz at noon).
    const cal = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const day = local(zoned(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), 12, tz), tz);
    for (const h of [...slots(day)].sort((a, b) => a - b)) {
      const t = zoned(day.y, day.m, day.d, h, tz);
      if (t >= after) return t;
    }
  }
  throw new Error('no slot within 60 days');
}

/** Clamp an event into opening hours [open, close) on allowed days, keeping its time if already inside. */
function withinHours(at: number, tz: string, open: number, close: number, isOpenDay: (day: Local) => boolean, jitterMs: number): number {
  const l = local(at, tz);
  const hour = l.h + l.mi / 60;
  if (isOpenDay(l) && hour >= open && hour < close) return at;
  return nextSlot(at, tz, (day) => (isOpenDay(day) ? [open] : [])) + jitterMs;
}

const holiday = (country: 'fr' | 'by', day: Local) => HOLIDAYS[country].includes(day.key);

// ───────────────────────── geometry ─────────────────────────

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

/** Cumulative distance fraction of each polyline vertex (0 at Lille, 1 at the recipient). */
export function routeFractions(poly: { lat: number; lon: number }[] = FR_BY_POLYLINE): number[] {
  const acc = [0];
  for (let i = 1; i < poly.length; i++) acc.push(acc[i - 1] + haversineKm(poly[i - 1], poly[i]));
  const total = acc[acc.length - 1];
  return acc.map((d) => d / total);
}

export function routeLengthKm(poly: { lat: number; lon: number }[] = FR_BY_POLYLINE): number {
  let km = 0;
  for (let i = 1; i < poly.length; i++) km += haversineKm(poly[i - 1], poly[i]);
  return km;
}

// ───────────────────────── S10 number ─────────────────────────

/** UPU S10 registered-letter number, e.g. "RR 123 456 785 FR" (weights 8 6 4 2 3 5 9 7). */
export function s10(seed: number): string {
  const serial = String(10000000 + Math.floor(uniform(seed, 's10') * 89999999)).slice(0, 8);
  const w = [8, 6, 4, 2, 3, 5, 9, 7];
  const sum = [...serial].reduce((s, c, i) => s + Number(c) * w[i], 0);
  let check = 11 - (sum % 11);
  if (check === 10) check = 0;
  if (check === 11) check = 5;
  const digits = serial + check;
  return `RR ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)} FR`;
}

// ───────────────────────── generator ─────────────────────────

export type ItineraryInput = {
  seed: number;
  /** End of the grace window: the letter is in the postbox from here. */
  collectAt: Date;
  tier: Tier;
  /** For standard/express: the delivery time already decided (compute_deliver_at). */
  deliverAt?: Date;
  /** Recalibration: 1.0 "romantic" (median ≈ 18 d), ≈ 1.6 closer to real reports. */
  scale?: number;
};

/** The full, realistic itinerary (postal tier). */
function postalEvents(seed: number, collectAt: number, scale: number): TrackingEvent[] {
  const fr = routeFractions();
  const P = FR_BY_POLYLINE;
  const placeOf = (i: number): Place => ({
    name: P[i].name ?? { fr: '', ru: '' },
    lat: P[i].lat,
    lon: P[i].lon,
    tz: P[i].tz,
    country: P[i].country,
  });
  const month = local(collectAt, PARIS);
  // Christmas mail: everything slower from 1 Dec to 10 Jan.
  const load = (month.m === 12 || (month.m === 1 && month.d <= 10) ? 1.4 : 1) * scale;
  const ln = (key: string, medianH: number, sigma: number) => lognormalHours(seed, key, medianH, sigma, load);
  const jitter = (key: string, maxMin: number) => uniform(seed, key) * maxMin * 60000;

  const events: Omit<TrackingEvent, 'seq'>[] = [];
  const push = (at: number, code: EventCode, vertex: number, office: string | null, visible = true, notify = false) =>
    events.push({ at: new Date(at).toISOString(), code, office, place: placeOf(vertex), routeT: fr[vertex], visible, notify });

  // Levée from the Lille box: Mon–Fri 12:00, Sat 11:00; never on Sundays or holidays.
  const leve = nextSlot(collectAt, PARIS, (d) => (holiday('fr', d) ? [] : d.wd <= 5 ? [12] : d.wd === 6 ? [11] : []));
  const ema = leve + jitter('ema', 25);
  push(ema, 'EMA', V.box, OFFICES.box);

  // PIC Lille-Lesquin: sorted in the evening/night; the trunk truck leaves at 03:00 Mon–Sat.
  const sorted = ema + 1.5 * HOUR + jitter('van', 60) + ln('pic', 6, 0.4);
  push(sorted, 'EDD', V.pic, OFFICES.pic);
  const truck = nextSlot(sorted, PARIS, (d) => (d.wd <= 6 && !holiday('fr', d) ? [3] : []));

  // Roissy, office of exchange: dwell, then the Belarus dispatch (Tue/Fri 20:00).
  const emb = truck + 3 * HOUR + jitter('a1', 45);
  push(emb, 'EMB', V.roissy, OFFICES.roissy);
  const ready = emb + ln('roissy', 48, 0.6);
  const emc = nextSlot(ready, PARIS, (d) => (d.wd === 2 || d.wd === 5 ? [20] : [])) + jitter('emc', 40);
  push(emc, 'EMC', V.roissy, OFFICES.roissy, true, false);

  // By road to the Polish–Belarusian border: no scans, only waypoints for the map.
  const atBorder = emc + ln('road', 90, 0.6);
  const roadFrom = fr[V.roissy];
  const roadTo = fr[V.borderPL];
  for (const w of V.waypoints) {
    const k = (fr[w] - roadFrom) / (roadTo - roadFrom);
    push(emc + (atBorder - emc) * k, 'WPT', w, null, false);
  }
  push(atBorder, 'WPT', V.borderPL, null, false);

  // The border: usually a day's queue; sometimes closed for a week or more (as in Sept 2025).
  let crossed = atBorder + ln('queue', 20, 0.8);
  if (uniform(seed, 'closed') < 0.03) {
    push(atBorder + 2 * HOUR, 'XBH', V.borderPL, null, true, false);
    crossed += ln('closure', 7 * 24, 0.4);
  }
  push(crossed, 'XBX', V.borderBY, null, false, false);

  // Minsk, office of exchange (customs post «Минская почта», 09–18 daily).
  const arrive = crossed + ln('to-minsk', 6, 0.3);
  const emd = withinHours(arrive, MINSK, 9, 18, () => true, jitter('emd', 50));
  push(emd, 'EMD', V.exchange, OFFICES.exchange, true, true);
  let leaveExchange = emd + ln('exchange', 72, 0.6);
  if (uniform(seed, 'customs') < 0.04) {
    const edb = withinHours(emd + ln('to-customs', 6, 0.5), MINSK, 9, 18, () => true, jitter('edb', 40));
    push(edb, 'EDB', V.exchange, OFFICES.exchange);
    const edc = withinHours(edb + ln('customs-h', 30, 0.5), MINSK, 9, 18, () => true, jitter('edc', 40));
    push(edc, 'EDC', V.exchange, OFFICES.exchange);
    leaveExchange = Math.max(leaveExchange, edc + 2 * HOUR);
  }
  const emf = withinHours(leaveExchange, MINSK, 9, 18, () => true, jitter('emf', 50));
  push(emf, 'EMF', V.exchange, OFFICES.exchange);

  // Local delivery office (Mon–Sat 08–20), then the next delivery round (10:00 / 16:00, Mon–Sat).
  const workDay = (d: Local) => d.wd <= 6 && !holiday('by', d);
  const emg = withinHours(emf + ln('to-office', 20, 0.4), MINSK, 8, 20, workDay, jitter('emg', 40));
  push(emg, 'EMG', V.office, OFFICES.office);
  const emi = nextSlot(emg + 2 * HOUR, MINSK, (d) => (workDay(d) ? [10, 16] : []));
  push(emi, 'EMI', V.office, null, true, false);

  return events.sort((a, b) => a.at.localeCompare(b.at)).map((e, seq) => ({ ...e, seq }));
}

/**
 * Express and standard keep their promised delivery time and replay the same
 * journey, compressed into it. Express keeps only a few scans ("pneumatique").
 */
function warp(events: TrackingEvent[], collectAt: number, deliverAt: number, tier: Tier): TrackingEvent[] {
  const t0 = Date.parse(events[0].at);
  const t1 = Date.parse(events[events.length - 1].at);
  const span = Math.max(deliverAt - collectAt, 1);
  const mapped = events.map((e) => ({ ...e, at: new Date(collectAt + ((Date.parse(e.at) - t0) * span) / (t1 - t0)).toISOString() }));
  const keepExpress = new Set<EventCode>(['EMA', 'EMD', 'EMI', 'WPT', 'XBX']);
  const out: TrackingEvent[] = [];
  let lastVisible = -Infinity;
  for (const e of mapped) {
    if (tier === 'express' && !keepExpress.has(e.code)) continue;
    const t = Date.parse(e.at);
    const firstOrLast = e.code === 'EMA' || e.code === 'EMI';
    if (e.visible && !firstOrLast && t - lastVisible < 20 * 60000) continue;
    if (e.code === 'EMI' && out.length && t - lastVisible < 20 * 60000) {
      // keep EMI, drop the visible scan crowding it
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].visible && out[i].code !== 'EMA') {
          out.splice(i, 1);
          break;
        }
      }
    }
    if (e.visible) lastVisible = t;
    // never notify about a compressed journey's intermediate scans
    out.push({ ...e, notify: false });
  }
  return out.map((e, seq) => ({ ...e, seq }));
}

function dayKey(ms: number, tz: string) {
  return local(ms, tz).key;
}

export function generateItinerary(input: ItineraryInput): Itinerary {
  const collect = input.collectAt.getTime();
  const scale = input.scale ?? 1;
  const full = postalEvents(input.seed, collect, scale);
  const lastFull = Date.parse(full[full.length - 1].at);

  if (input.tier === 'postal') {
    const deliver = lastFull;
    // The window around the real arrival: never later than shown, never absurdly early.
    let lo = deliver - (2 + 3 * uniform(input.seed, 'lo')) * DAY;
    const hi = deliver + (3 + 5 * uniform(input.seed, 'hi')) * DAY;
    lo = Math.max(lo, collect + 6 * DAY);
    return {
      route: 'FR-BY',
      tier: 'postal',
      collectAt: input.collectAt.toISOString(),
      deliverAt: new Date(deliver).toISOString(),
      window: { lo: dayKey(Math.min(lo, deliver), MINSK), hi: dayKey(hi, MINSK) },
      s10: s10(input.seed),
      events: full,
    };
  }

  if (!input.deliverAt) throw new Error(`${input.tier} needs deliverAt`);
  const deliver = input.deliverAt.getTime();
  const events = warp(full, collect, deliver, input.tier);
  const day = dayKey(deliver, MINSK);
  return {
    route: 'FR-BY',
    tier: input.tier,
    collectAt: input.collectAt.toISOString(),
    deliverAt: new Date(deliver).toISOString(),
    window: { lo: day, hi: day },
    s10: s10(input.seed),
    events,
  };
}

/** Events a viewer may see at `now` (the server enforces the same with RLS). */
export function visibleAt(it: Itinerary, now: Date): TrackingEvent[] {
  const t = now.getTime();
  return it.events.filter((e) => e.visible && Date.parse(e.at) <= t);
}

/**
 * Where the letter probably is at `now`: interpolated along the route between the
 * surrounding events (visible or silent). Clients show it as "probably around here".
 */
export function estimatedRouteT(it: Itinerary, now: Date): number {
  const t = now.getTime();
  const ev = it.events;
  if (t <= Date.parse(ev[0].at)) return 0;
  for (let i = 1; i < ev.length; i++) {
    const a = Date.parse(ev[i - 1].at);
    const b = Date.parse(ev[i].at);
    if (t <= b) return ev[i - 1].routeT + ((ev[i].routeT - ev[i - 1].routeT) * (t - a)) / Math.max(b - a, 1);
  }
  return 1;
}

/** The next delivery round (10:00 / 16:00, Mon–Sat, no Belarusian holidays) at or after `after`. */
export function nextDeliveryRound(after: Date, tz = MINSK): Date {
  return new Date(nextSlot(after.getTime(), tz, (d) => (d.wd <= 6 && !holiday('by', d) ? [10, 16] : [])));
}
