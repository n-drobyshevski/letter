-- Posting & receiving: the recipient learns of a letter only once it has been collected
-- (after the sender's grace window), and every state change is a written row change so
-- Realtime can deliver it.

alter table public.letters add column collected_at timestamptz;
alter table public.letter_receipts
  add column opened_by text not null default 'slit' check (opened_by in ('slit', 'seal', 'replay'));

-- A letter still in the postbox (before collect_at) is the sender's business only.
-- (Altered in place: this migration drops nothing.)
alter policy "envelopes" on public.letters
  using (
    sender_id = auth.uid()
    or (recipient_id = auth.uid() and retrieved_at is null and collect_at <= now())
  );

-- How it was opened: slit, seal or replay. No default on p_opened_by, so the
-- one-argument open_letter below stays unambiguous (it keeps meaning 'slit').
create function public.open_letter(p_letter_id uuid, p_opened_by text)
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
  insert into public.letter_receipts (letter_id, opened_by) values (p_letter_id, p_opened_by)
  on conflict do nothing;
end
$$;
revoke all on function public.open_letter(uuid, text) from public, anon;
grant execute on function public.open_letter(uuid, text) to authenticated;

create or replace function public.open_letter(p_letter_id uuid)
returns void
language sql volatile security definer
set search_path = ''
as $$
  select public.open_letter(p_letter_id, 'slit')
$$;

-- Stamp collection the same way delivery is stamped (pg_cron calls this every minute).
create function public.collect_posted()
returns integer
language sql volatile security definer
set search_path = ''
as $$
  with stamped as (
    update public.letters set collected_at = now()
     where collected_at is null and retrieved_at is null and collect_at <= now()
    returning 1
  )
  select count(*)::integer from stamped
$$;
revoke all on function public.collect_posted from public, anon, authenticated;

-- Supabase-only: schedule it next to the delivery job.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('collect-mail', '* * * * *', 'select public.collect_posted()');
  end if;
end
$$;
