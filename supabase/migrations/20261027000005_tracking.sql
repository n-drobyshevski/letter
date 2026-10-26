-- Delivery tracking: the itinerary (scans, silent waypoints) generated at posting by
-- the post-letter Edge Function from src/letter/tracking/itinerary.ts, stored here,
-- revealed to the couple one scan at a time as the clock passes them.
-- Invariants (tests/sql.test.ts):
--   * written only by the server (service role), never by clients;
--   * nobody sees a scan before its time, or a silent waypoint at all;
--   * the recipient sees nothing until the letter is collected (as for letters);
--   * the last visible scan is the delivery (EMI) at exactly deliver_at.

alter table public.letters add column tracking jsonb; -- { route, s10, window: { lo, hi } }

create table public.tracking_events (
  letter_id uuid not null references public.letters (id) on delete cascade,
  seq smallint not null,
  at timestamptz not null,
  code text not null,
  office text,
  place jsonb not null,      -- { name: { fr, ru }, lat, lon, tz, country }
  route_t real not null,     -- position along the route, 0..1
  visible boolean not null default true,
  notify boolean not null default false,
  revealed_at timestamptz,
  primary key (letter_id, seq)
);
create index tracking_unrevealed_idx on public.tracking_events (at) where revealed_at is null;

alter table public.tracking_events enable row level security;
create policy "scans so far" on public.tracking_events
  for select to authenticated using (
    visible and at <= now()
    and exists (
      select 1 from public.letters l
       where l.id = letter_id and l.retrieved_at is null
         and (l.sender_id = auth.uid() or (l.recipient_id = auth.uid() and l.collected_at is not null))
    )
  );

-- Validate an itinerary against its letter's times. Raises on anything inconsistent.
create function public.check_itinerary(p_collect_at timestamptz, p_deliver_at timestamptz, p_events jsonb)
returns void
language plpgsql stable
set search_path = ''
as $$
declare
  first_visible jsonb;
  last_visible jsonb;
  prev timestamptz := '-infinity';
  e jsonb;
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) = 0 then
    raise exception 'itinerary has no events';
  end if;
  for e in select value from jsonb_array_elements(p_events) loop
    if (e->>'at')::timestamptz < prev then
      raise exception 'itinerary events out of order';
    end if;
    prev := (e->>'at')::timestamptz;
    if (e->>'at')::timestamptz < p_collect_at or (e->>'at')::timestamptz > p_deliver_at then
      raise exception 'itinerary event outside [collect_at, deliver_at]';
    end if;
  end loop;
  select value into first_visible from jsonb_array_elements(p_events) where (value->>'visible')::boolean order by (value->>'at')::timestamptz, (value->>'seq')::int limit 1;
  select value into last_visible from jsonb_array_elements(p_events) where (value->>'visible')::boolean order by (value->>'at')::timestamptz desc, (value->>'seq')::int desc limit 1;
  if first_visible->>'code' <> 'EMA' then
    raise exception 'the first scan must be the collection (EMA)';
  end if;
  if last_visible->>'code' <> 'EMI' or (last_visible->>'at')::timestamptz <> p_deliver_at then
    raise exception 'the last scan must be the delivery (EMI) at deliver_at';
  end if;
end
$$;

create function public.insert_itinerary(p_letter_id uuid, p_events jsonb)
returns void
language sql volatile security definer
set search_path = ''
as $$
  insert into public.tracking_events (letter_id, seq, at, code, office, place, route_t, visible, notify)
  select p_letter_id, (e->>'seq')::smallint, (e->>'at')::timestamptz, e->>'code', e->>'office', e->'place',
         (e->>'routeT')::real, (e->>'visible')::boolean, coalesce((e->>'notify')::boolean, false)
    from jsonb_array_elements(p_events) e
$$;

-- Postal tier: the itinerary decides deliver_at. Called by the post-letter function
-- (service role) on behalf of p_sender, after it authenticated the user.
create function public.record_posting(
  p_sender uuid,
  p_body jsonb,
  p_envelope jsonb,
  p_seed integer,
  p_collect_at timestamptz,
  p_deliver_at timestamptz,
  p_tracking jsonb,
  p_events jsonb
)
returns public.letters
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me public.profiles;
  them public.profiles;
  letter public.letters;
begin
  select * into me from public.profiles where id = p_sender;
  if not found then
    raise exception 'unknown sender';
  end if;
  select * into them from public.profiles where couple_id = me.couple_id and id <> me.id;
  if not found then
    raise exception 'no recipient in this couple yet';
  end if;
  -- The grace window starts now: collection is about an hour away, never in the past.
  if p_collect_at < now() - interval '5 minutes' or p_collect_at > now() + interval '2 hours' then
    raise exception 'collect_at must be within the next two hours';
  end if;
  perform public.check_itinerary(p_collect_at, p_deliver_at, p_events);

  insert into public.letters (couple_id, sender_id, recipient_id, tier, posted_at, collect_at, deliver_at, envelope, seed, tracking)
  values (
    me.couple_id, me.id, them.id, 'postal', least(now(), p_collect_at), p_collect_at, p_deliver_at,
    coalesce(p_envelope, '{}'::jsonb) || jsonb_build_object(
      'postmark', jsonb_build_object('city', me.city, 'date', (now() at time zone me.tz)::date)
    ),
    p_seed, p_tracking
  )
  returning * into letter;
  insert into public.letter_contents (letter_id, body) values (letter.id, p_body);
  perform public.insert_itinerary(letter.id, p_events);
  return letter;
end
$$;

-- Express / standard: post_letter decided the times; attach the compressed itinerary.
create function public.record_tracking(p_letter_id uuid, p_tracking jsonb, p_events jsonb)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  letter public.letters;
begin
  select * into letter from public.letters where id = p_letter_id;
  if not found then
    raise exception 'unknown letter';
  end if;
  if exists (select 1 from public.tracking_events where letter_id = p_letter_id) then
    raise exception 'letter already has an itinerary';
  end if;
  perform public.check_itinerary(letter.collect_at, letter.deliver_at, p_events);
  update public.letters set tracking = p_tracking where id = p_letter_id;
  perform public.insert_itinerary(p_letter_id, p_events);
end
$$;

-- Taking a letter back hides its journey: "scans so far" requires retrieved_at is null,
-- and tracking_estimate checks the same. Nothing is deleted (as for the letter itself).

-- Each minute: stamp scans whose time has come, so Realtime tells the app.
create function public.reveal_tracking()
returns integer
language sql volatile security definer
set search_path = ''
as $$
  with stamped as (
    update public.tracking_events set revealed_at = now()
     where revealed_at is null and at <= now()
    returning 1
  )
  select count(*)::integer from stamped
$$;

revoke all on function public.check_itinerary, public.insert_itinerary, public.record_posting, public.record_tracking, public.reveal_tracking
  from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.record_posting, public.record_tracking to service_role;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('reveal-tracking', '* * * * *', 'select public.reveal_tracking()');
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.tracking_events;
  end if;
end
$$;
