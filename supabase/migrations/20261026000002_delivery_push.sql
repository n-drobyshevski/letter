-- Delivery dispatch + private storage. Needs Supabase extensions (pg_cron, pg_net, vault),
-- so it is kept apart from the schema migration that the PGlite tests run.
--
-- Store two secrets (SQL; they are read at dispatch time, not when applying):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'deliver_secret');
-- The deliver function checks the token with deliver_secret_ok() (service role), so no
-- key is ever copied by hand and the service-role key never leaves Supabase.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Every minute: letters whose deliver_at has passed get one push (idempotent via pushed_at).
-- The mailbox flag itself is driven by Realtime + the derived status, not by this job.
create function public.dispatch_deliveries()
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  due uuid[];
begin
  with picked as (
    select id from public.letters
     where pushed_at is null and retrieved_at is null and deliver_at <= now()
     order by deliver_at
     limit 100
     for update skip locked
  ), stamped as (
    update public.letters l set pushed_at = now()
      from picked where l.id = picked.id
    returning l.id
  )
  select array_agg(id) into due from stamped;

  if due is null or cardinality(due) = 0 then
    return 0;
  end if;

  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/deliver',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'deliver_secret')
    ),
    body := jsonb_build_object('letter_ids', to_jsonb(due))
  );
  return cardinality(due);
end
$$;

revoke all on function public.dispatch_deliveries from public, anon, authenticated;

-- The deliver function's gate: is this the token dispatch_deliveries sends?
create function public.deliver_secret_ok(p_token text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'deliver_secret' and decrypted_secret = p_token)
$$;
revoke all on function public.deliver_secret_ok from public, anon, authenticated;
grant execute on function public.deliver_secret_ok to service_role;

select cron.schedule('deliver-mail', '* * * * *', $$ select public.dispatch_deliveries() $$);

-- Realtime: the recipient's mailbox listens for new envelopes.
alter publication supabase_realtime add table public.letters;

-- ───────────────────────── storage ─────────────────────────
-- Private bucket; objects live under "<letter_id>/<file>".
insert into storage.buckets (id, name, public) values ('letters', 'letters', false)
on conflict (id) do nothing;

create policy "read letter files after delivery" on storage.objects
  for select to authenticated
  using (bucket_id = 'letters' and public.can_read_contents(((storage.foldername(name))[1])::uuid));

create policy "sender uploads while the letter is still in the postbox" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'letters'
    and exists (
      select 1 from public.letters l
       where l.id = ((storage.foldername(name))[1])::uuid
         and l.sender_id = auth.uid()
         and now() < l.collect_at
    )
  );
