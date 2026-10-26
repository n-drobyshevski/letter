import type { Session } from '@supabase/supabase-js';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { mailboxFromServer, type ContentRow, type MailLetter, type MailRow, type ReceiptRow } from '@/letter/mailboxFromServer';
import type { OpenedBy } from '@/letter/ReceivingCeremony';
import { itineraryFromServer, type EventRow, type LetterRow } from '@/letter/tracking/fromServer';
import type { Itinerary, Tier } from '@/letter/tracking/itinerary';

import { supabase } from './supabase';

/**
 * The app's side of the post office: who is signed in, posting through the
 * post-letter Edge Function, taking a letter back, and reading its journey.
 * Everything here needs a configured project (`supabase` non-null).
 */

export type Profile = {
  id: string;
  display_name: string;
  city: string;
  tz: string;
  locale: 'ru' | 'fr';
};
export type Couple = { me: Profile; them: Profile | null };
export type PostTier = Tier | 'scheduled';

/** undefined while the stored session loads, then the session or null. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

/** The two profiles of the signed-in couple (RLS shows exactly these). */
export function useCouple(userId: string | undefined): {
  couple: Couple | null;
  error: string | null;
} {
  const [couple, setCouple] = useState<Couple | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!supabase || !userId) return;
    let live = true;
    supabase
      .from('profiles')
      .select('id, display_name, city, tz, locale')
      .then(({ data, error: e }) => {
        if (!live) return;
        const me = data?.find((p) => p.id === userId);
        if (e || !me) setError(e?.message ?? 'no profile for this account');
        else
          setCouple({
            me: me as Profile,
            them: (data!.find((p) => p.id !== userId) as Profile) ?? null,
          });
      });
    return () => {
      live = false;
    };
  }, [userId]);
  return { couple, error };
}

/** The Edge Function puts its reason in the JSON body; surface that, not "non-2xx status". */
async function reason(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return String(body.error);
    } catch {
      // not JSON
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export type PostInput = {
  tier: PostTier;
  body: unknown;
  envelope: Record<string, unknown>;
  seed: number;
  /** YYYY-MM-DD, scheduled tier only. */
  scheduledFor?: string;
};

/** Posts through post-letter: the server decides collect_at/deliver_at and the journey. */
export async function postLetter(input: PostInput): Promise<LetterRow> {
  if (!supabase) throw new Error('no backend configured');
  const { data, error } = await supabase.functions.invoke<LetterRow>('post-letter', { body: input });
  if (error || !data) throw new Error(await reason(error));
  return data;
}

/** Takes a letter back out of the box during the grace window (its journey disappears with it). */
export async function retrieveLetter(id: string): Promise<void> {
  if (!supabase) throw new Error('no backend configured');
  const { error } = await supabase.rpc('retrieve_letter', { p_letter_id: id });
  if (error) throw new Error(error.message);
}

const LETTER_COLUMNS = 'id, tier, sender_id, recipient_id, collect_at, deliver_at, retrieved_at, tracking';

/** Letters still on their way, to or from me (RLS hides hers until collected). */
export function useLettersInTransit(userId: string | undefined, refreshKey = 0): LetterRow[] {
  const [letters, setLetters] = useState<LetterRow[]>([]);
  useEffect(() => {
    if (!supabase || !userId) return;
    let live = true;
    supabase
      .from('letters')
      .select(LETTER_COLUMNS)
      .is('retrieved_at', null)
      .gt('deliver_at', new Date().toISOString())
      .order('deliver_at')
      .then(({ data }) => live && setLetters((data as LetterRow[]) ?? []));
    return () => {
      live = false;
    };
  }, [userId, refreshKey]);
  return letters;
}

export type Tracking = {
  letter: LetterRow;
  itinerary: Itinerary | null;
  /** Server estimate of the position now (tracking_estimate), null if unknown. */
  estimate: number | null;
};

async function fetchTracking(letterId: string): Promise<{ tracking: Tracking } | { error: string }> {
  const [letter, events, estimate] = await Promise.all([
    supabase!.from('letters').select(LETTER_COLUMNS).eq('id', letterId).maybeSingle(),
    supabase!
      .from('tracking_events')
      .select('seq, at, code, office, place, route_t, notify')
      .eq('letter_id', letterId)
      .order('at')
      .order('seq'),
    supabase!.rpc('tracking_estimate', { p_letter_id: letterId }),
  ]);
  const e = letter.error ?? events.error;
  if (e) return { error: e.message };
  if (!letter.data) return { error: 'not found' };
  const row = letter.data as LetterRow;
  return {
    tracking: {
      letter: row,
      itinerary: itineraryFromServer(row, (events.data as EventRow[]) ?? []),
      estimate: typeof estimate.data === 'number' ? estimate.data : null,
    },
  };
}

/**
 * One letter's journey as the server reveals it: the scans so far, refreshed when
 * reveal_tracking stamps a new one (Realtime) and every few minutes regardless.
 */
export function useTracking(letterId: string | undefined): {
  tracking: Tracking | null;
  error: string | null;
} {
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !letterId) return;
    let live = true;
    const load = () =>
      fetchTracking(letterId).then((r) => {
        if (!live) return;
        if ('error' in r) setError(r.error);
        else {
          setError(null);
          setTracking(r.tracking);
        }
      });
    load();
    const every = setInterval(load, 5 * 60e3);
    const channel = supabase
      .channel(`tracking:${letterId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tracking_events',
          filter: `letter_id=eq.${letterId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      live = false;
      clearInterval(every);
      supabase?.removeChannel(channel);
    };
  }, [letterId]);

  return { tracking, error };
}

export type Mailbox = { waiting: MailLetter[]; opened: MailLetter[]; loaded: boolean };

/**
 * My mailbox: letters delivered to me, not yet opened (oldest first), and the
 * shoebox of opened ones. Refreshes on Realtime changes to my letters, at the
 * next delivery time, and when the app comes back to the foreground.
 */
export function useMailbox(couple: Couple | null, refreshKey = 0): Mailbox {
  const [box, setBox] = useState<Mailbox>({ waiting: [], opened: [], loaded: false });
  useEffect(() => {
    if (!supabase || !couple) return;
    const db = supabase;
    const me = couple.me.id;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const { data: rows } = await db
        .from('letters')
        .select('id, sender_id, recipient_id, deliver_at, retrieved_at, seed, envelope')
        .eq('recipient_id', me)
        .is('retrieved_at', null)
        .order('deliver_at');
      const delivered = ((rows as MailRow[]) ?? []).filter((r) => Date.parse(r.deliver_at) <= Date.now()).map((r) => r.id);
      // Contents are readable once delivered (RLS); receipts are always mine to see.
      const [contents, receipts] = delivered.length
        ? await Promise.all([
            db.from('letter_contents').select('letter_id, body').in('letter_id', delivered),
            db.from('letter_receipts').select('letter_id, opened_at').in('letter_id', delivered),
          ])
        : [{ data: [] }, { data: [] }];
      if (!live) return;
      const next = mailboxFromServer({
        rows: (rows as MailRow[]) ?? [],
        contents: (contents.data as ContentRow[]) ?? [],
        receipts: (receipts.data as ReceiptRow[]) ?? [],
        me: couple.me,
        them: couple.them,
        now: Date.now(),
      });
      setBox({ waiting: next.waiting, opened: next.opened, loaded: true });
      clearTimeout(timer);
      // setTimeout caps at ~24.8 days; a longer wait just checks again then.
      if (next.nextAt) timer = setTimeout(load, Math.min(next.nextAt - Date.now() + 1000, 2 ** 31 - 1));
    };
    load();
    const channel = db
      .channel(`mailbox:${me}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'letters', filter: `recipient_id=eq.${me}` }, () => load())
      .subscribe();
    const foreground = AppState.addEventListener('change', (s) => s === 'active' && load());
    return () => {
      live = false;
      clearTimeout(timer);
      foreground.remove();
      db.removeChannel(channel);
    };
  }, [couple, refreshKey]);
  return box;
}

/** The recipient opened it (idempotent): a private receipt, and how the seal was broken. */
export async function openLetter(id: string, by: OpenedBy): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('open_letter', { p_letter_id: id, p_opened_by: by });
  if (error) console.warn('open_letter', error.message);
}
