import { arrivalLine, windowLine, type Lang } from './copy';
import type { EventCode, Itinerary, Place, Tier, TrackingEvent } from './itinerary';

/**
 * Rows as the app reads them through RLS: the letter (its promise) and the scans
 * so far. Silent waypoints never reach the client; the server's estimate of where
 * the letter is now (tracking_estimate) stands in for them.
 */

export type LetterRow = {
  id: string;
  tier: Tier | 'scheduled';
  sender_id: string;
  recipient_id: string;
  collect_at: string;
  deliver_at: string;
  retrieved_at: string | null;
  tracking: {
    route: string;
    s10: string;
    window: { lo: string; hi: string };
  } | null;
};

export type EventRow = {
  seq: number;
  at: string;
  code: string;
  office: string | null;
  place: Place;
  route_t: number;
  notify: boolean;
};

/** The itinerary the map and timeline draw, from what the server let us see. Null without tracking. */
export function itineraryFromServer(letter: LetterRow, rows: EventRow[]): Itinerary | null {
  if (!letter.tracking || letter.tier === 'scheduled') return null;
  const events: TrackingEvent[] = [...rows]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.seq - b.seq)
    .map((r) => ({
      seq: r.seq,
      // Postgres prints "+00:00"; the components parse either.
      at: new Date(r.at).toISOString(),
      code: r.code as EventCode,
      office: r.office,
      place: r.place,
      routeT: r.route_t,
      visible: true,
      notify: r.notify,
    }));
  return {
    route: letter.tracking.route,
    tier: letter.tier,
    collectAt: new Date(letter.collect_at).toISOString(),
    deliverAt: new Date(letter.deliver_at).toISOString(),
    window: letter.tracking.window,
    s10: letter.tracking.s10,
    events,
  };
}

/** What the sender was promised: the window for a real-post letter, else the arrival time. */
export function promiseLine(letter: LetterRow, lang: Lang, recipientTz: string): string {
  const it = itineraryFromServer(letter, []);
  return it ? windowLine(it, lang, recipientTz) : arrivalLine(letter.deliver_at, lang, recipientTz);
}
