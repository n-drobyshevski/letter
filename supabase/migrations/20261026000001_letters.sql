-- Letters for two: schema, delivery-time algorithm, row-level security.
-- Invariants (see .claude/skills/postal-rules):
--   * The server alone decides deliver_at; clients cannot write letters directly.
--   * The recipient sees the sealed envelope immediately, its contents only once deliver_at has passed.
--   * A letter is never lost and never randomly delayed beyond the estimate shown at posting time.

-- ───────────────────────── types & tables ─────────────────────────

create type public.delivery_tier as enum ('express', 'standard', 'scheduled');

create table public.couples (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  couple_id uuid not null references public.couples (id),
  display_name text not null,
  pet_name text,
  city text not null,
  lat double precision,
  lon double precision,
  tz text not null default 'Europe/Paris',
  locale text not null default 'ru' check (locale in ('ru', 'fr')),
  read_receipts boolean not null default false,
  created_at timestamptz not null default now()
);
create index profiles_couple_idx on public.profiles (couple_id);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now()
);

create table public.letters (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id),
  sender_id uuid not null references public.profiles (id),
  recipient_id uuid not null references public.profiles (id),
  tier public.delivery_tier not null,
  posted_at timestamptz not null default now(),
  -- End of the grace window: until then the sender may take the letter back.
  collect_at timestamptz not null,
  deliver_at timestamptz not null,
  retrieved_at timestamptz,
  pushed_at timestamptz,
  -- paper, ink, font, stamp, seal{colour, initials, seed}, postmark{city, date}
  envelope jsonb not null default '{}'::jsonb,
  seed integer not null,
  render_v smallint not null default 1,
  schema_v smallint not null default 1,
  check (sender_id <> recipient_id),
  check (collect_at <= deliver_at),
  check (posted_at <= collect_at)
);
create index letters_recipient_idx on public.letters (recipient_id, deliver_at desc);
create index letters_due_idx on public.letters (deliver_at) where pushed_at is null and retrieved_at is null;

-- Contents live apart from the envelope so RLS can show one without the other.
create table public.letter_contents (
  letter_id uuid primary key references public.letters (id) on delete cascade,
  body jsonb not null,            -- { text, strokes, font, ink, paper } — schema_v 1
  page_image_path text            -- baked page in storage: the canonical copy
);

-- Kept apart from letters: the sender must not learn of an opening unless both opted in.
create table public.letter_receipts (
  letter_id uuid primary key references public.letters (id) on delete cascade,
  opened_at timestamptz not null default now()
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null references public.letters (id) on delete cascade,
  storage_path text not null,
  kind text not null check (kind in ('photo', 'pressed_flower', 'sticker', 'drawing')),
  created_at timestamptz not null default now()
);

-- ───────────────────────── delivery-time algorithm ─────────────────────────

create function public.haversine_km(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision
language sql immutable
set search_path = ''
as $$
  select 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  ))
$$;

-- The first post round (10:00 or 16:00, recipient's local time, no Sunday rounds) at or after `after`.
-- Local wall-clock arithmetic happens in `tz`, so DST changes are handled by Postgres.
create function public.next_post_round(after timestamptz, tz text)
returns timestamptz
language plpgsql stable
set search_path = ''
as $$
declare
  local_after timestamp := after at time zone tz;
  day date := (after at time zone tz)::date;
  round time;
  candidate timestamp;
begin
  for i in 0..14 loop
    if extract(isodow from day + i) <> 7 then
      foreach round in array array['10:00'::time, '16:00'::time] loop
        candidate := (day + i) + round;
        if candidate >= local_after then
          return candidate at time zone tz;
        end if;
      end loop;
    end if;
  end loop;
  raise exception 'no post round within two weeks of %', after;
end
$$;

-- Pure function of its inputs (jitter included) so it can be tested exhaustively.
--   express    next round at least 2 h after posting
--   standard   12–72 h depending on distance (~40 km/h door to door, ±15 %), then the next round
--   scheduled  10:00 local on the chosen day (at least 2 h away)
create function public.compute_deliver_at(
  tier public.delivery_tier,
  posted timestamptz,
  recipient_tz text,
  distance_km double precision,
  scheduled_for date,
  jitter double precision
)
returns timestamptz
language plpgsql stable
set search_path = ''
as $$
declare
  hours double precision;
  target timestamptz;
begin
  if jitter < -0.15 or jitter > 0.15 then
    raise exception 'jitter out of range';
  end if;
  case tier
    when 'express' then
      return public.next_post_round(posted + interval '2 hours', recipient_tz);
    when 'standard' then
      hours := greatest(12, least(72, coalesce(distance_km, 960) / 40)) * (1 + jitter);
      return public.next_post_round(posted + make_interval(secs => hours * 3600), recipient_tz);
    when 'scheduled' then
      if scheduled_for is null then
        raise exception 'scheduled letters need a date';
      end if;
      target := (scheduled_for + '10:00'::time) at time zone recipient_tz;
      if target < posted + interval '2 hours' then
        raise exception 'scheduled date must be at least 2 hours away';
      end if;
      return target;
  end case;
end
$$;

-- ───────────────────────── status (derived, never stored) ─────────────────────────

create view public.letter_status
with (security_invoker = true)
as
select
  l.*,
  case
    when l.retrieved_at is not null then 'retrieved'
    when now() < l.collect_at then 'posted'
    when now() < l.deliver_at then 'in_transit'
    else 'delivered'
  end as status
from public.letters l;

-- ───────────────────────── RPCs (the only write path) ─────────────────────────

create function public.my_couple_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select couple_id from public.profiles where id = auth.uid()
$$;

create function public.post_letter(
  p_tier public.delivery_tier,
  p_body jsonb,
  p_envelope jsonb,
  p_seed integer,
  p_scheduled_for date default null
)
returns public.letters
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me public.profiles;
  them public.profiles;
  posted timestamptz := now();
  deliver timestamptz;
  letter public.letters;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found then
    raise exception 'not signed in as a member of a couple';
  end if;
  select * into them from public.profiles where couple_id = me.couple_id and id <> me.id;
  if not found then
    raise exception 'no recipient in this couple yet';
  end if;

  deliver := public.compute_deliver_at(
    p_tier, posted, them.tz,
    public.haversine_km(me.lat, me.lon, them.lat, them.lon),
    p_scheduled_for,
    random() * 0.3 - 0.15
  );

  insert into public.letters (couple_id, sender_id, recipient_id, tier, posted_at, collect_at, deliver_at, envelope, seed)
  values (
    me.couple_id, me.id, them.id, p_tier, posted,
    least(posted + interval '1 hour', deliver),
    deliver,
    coalesce(p_envelope, '{}'::jsonb) || jsonb_build_object(
      'postmark', jsonb_build_object('city', me.city, 'date', (posted at time zone me.tz)::date)
    ),
    p_seed
  )
  returning * into letter;

  insert into public.letter_contents (letter_id, body) values (letter.id, p_body);
  return letter;
end
$$;

-- Take a letter back out of the postbox during the grace window.
create function public.retrieve_letter(p_letter_id uuid)
returns public.letters
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  letter public.letters;
begin
  update public.letters
     set retrieved_at = now()
   where id = p_letter_id
     and sender_id = auth.uid()
     and retrieved_at is null
     and now() < collect_at
  returning * into letter;
  if not found then
    raise exception 'too late: the letter has already been collected';
  end if;
  return letter;
end
$$;

-- The recipient breaks the seal. Idempotent.
create function public.open_letter(p_letter_id uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.letters
     where id = p_letter_id and recipient_id = auth.uid()
       and retrieved_at is null and deliver_at <= now()
  ) then
    raise exception 'letter not delivered to you';
  end if;
  insert into public.letter_receipts (letter_id) values (p_letter_id) on conflict do nothing;
end
$$;

-- ───────────────────────── row-level security ─────────────────────────

alter table public.couples enable row level security;
alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.letters enable row level security;
alter table public.letter_contents enable row level security;
alter table public.letter_receipts enable row level security;
alter table public.attachments enable row level security;

create policy "own couple" on public.couples
  for select to authenticated using (id = public.my_couple_id());

create policy "couple members" on public.profiles
  for select to authenticated using (couple_id = public.my_couple_id());
create policy "edit own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and couple_id = public.my_couple_id());

create policy "own devices" on public.devices
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Envelopes: the sender always; the recipient as soon as it is posted (it is "in the post"),
-- except letters taken back during the grace window.
create policy "envelopes" on public.letters
  for select to authenticated using (
    sender_id = auth.uid()
    or (recipient_id = auth.uid() and retrieved_at is null)
  );

create function public.can_read_contents(p_letter_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.letters l
     where l.id = p_letter_id
       and (
         l.sender_id = auth.uid()
         or (l.recipient_id = auth.uid() and l.retrieved_at is null and l.deliver_at <= now())
       )
  )
$$;

create policy "contents after delivery" on public.letter_contents
  for select to authenticated using (public.can_read_contents(letter_id));

create policy "attachments after delivery" on public.attachments
  for select to authenticated using (public.can_read_contents(letter_id));

-- Receipts: always visible to the recipient; to the sender only if both opted in.
create policy "receipts" on public.letter_receipts
  for select to authenticated using (
    exists (
      select 1 from public.letters l
       where l.id = letter_id
         and (
           l.recipient_id = auth.uid()
           or (
             l.sender_id = auth.uid()
             and (select bool_and(read_receipts) from public.profiles p where p.couple_id = l.couple_id)
           )
         )
    )
  );

revoke all on function public.compute_deliver_at from public, anon;
revoke all on function public.post_letter from public, anon;
revoke all on function public.retrieve_letter from public, anon;
revoke all on function public.open_letter from public, anon;
grant execute on function public.post_letter, public.retrieve_letter, public.open_letter to authenticated;
