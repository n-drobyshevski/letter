// Posting a letter, with its journey.
//
// The app calls this (with the user's JWT) instead of the post_letter RPC:
//   * postal tier: the itinerary decides deliver_at → record_posting (service role);
//   * express / standard / scheduled: post_letter decides the times (as the user),
//     then the same journey, compressed, is attached → record_tracking.
// The generator is src/letter/tracking/itinerary.ts, copied by `npm run sync:shared`.
// Only France → Belarus is routed so far; other pairs post without tracking.
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { generateItinerary, routed as isRouted, type Tier } from '../_shared/itinerary.ts';

type Body = {
  tier: Tier | 'scheduled';
  body: unknown;
  envelope?: Record<string, unknown>;
  seed: number;
  scheduledFor?: string;
};

// The laptop calls this from the browser: answer the CORS preflight.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('authorization') ?? '' } },
  });
  const { data: auth } = await asUser.auth.getUser();
  if (!auth.user) return json({ error: 'not signed in' }, 401);
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const input = (await req.json()) as Body;
  const { data: me } = await admin.from('profiles').select('couple_id, tz').eq('id', auth.user.id).single();
  if (!me) return json({ error: 'not a member of a couple' }, 403);
  const { data: them } = await admin.from('profiles').select('tz').eq('couple_id', me.couple_id).neq('id', auth.user.id).single();
  const routed = isRouted(me.tz, them?.tz);

  if (input.tier === 'postal') {
    if (!routed) return json({ error: 'real-post delivery is only routed France → Belarus for now' }, 422);
    // The grace window: the box is emptied about an hour from now.
    const collectAt = new Date(Date.now() + 60 * 60 * 1000);
    const it = generateItinerary({ seed: input.seed, collectAt, tier: 'postal' });
    const { data, error } = await admin.rpc('record_posting', {
      p_sender: auth.user.id,
      p_body: input.body,
      p_envelope: input.envelope ?? {},
      p_seed: input.seed,
      p_collect_at: it.collectAt,
      p_deliver_at: it.deliverAt,
      p_tracking: { route: it.route, s10: it.s10, window: it.window },
      p_events: it.events,
    });
    if (error) return json({ error: error.message }, 400);
    return json(data);
  }

  const { data: letter, error } = await asUser.rpc('post_letter', {
    p_tier: input.tier,
    p_body: input.body,
    p_envelope: input.envelope ?? {},
    p_seed: input.seed,
    p_scheduled_for: input.scheduledFor ?? null,
  });
  if (error) return json({ error: error.message }, 400);
  if (routed && input.tier !== 'scheduled') {
    const it = generateItinerary({
      seed: input.seed,
      collectAt: new Date(letter.collect_at),
      tier: input.tier,
      deliverAt: new Date(letter.deliver_at),
    });
    const { error: trackingError } = await admin.rpc('record_tracking', {
      p_letter_id: letter.id,
      p_tracking: { route: it.route, s10: it.s10, window: it.window },
      p_events: it.events,
    });
    // A letter without tracking is still a letter: never fail the posting over it.
    if (trackingError) console.error('tracking not recorded', letter.id, trackingError.message);
    else return json({ ...letter, tracking: { route: it.route, s10: it.s10, window: it.window } });
  }
  return json(letter);
});
