import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * Applies both migrations with stand-ins for Supabase-only pieces
 * (auth, vault, pg_net, pg_cron, storage, realtime publication) and checks
 * that due letters get exactly one push request.
 */

const read = (f: string) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8');

const STUBS = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create schema vault;
create view vault.decrypted_secrets as
  select * from (values ('project_url', 'https://ref.supabase.co'), ('service_role_key', 'srk')) s(name, decrypted_secret);

create schema net;
create table net.requests (id serial, url text, headers jsonb, body jsonb);
create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $$
  insert into net.requests (url, headers, body) values (url, headers, body) returning id $$;

create schema cron;
create table cron.jobs (name text, schedule text, command text);
create function cron.schedule(name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.jobs values (name, schedule, command) returning 1::bigint $$;

create publication supabase_realtime;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`;

const withoutExtensions = (sql: string) => sql.replace(/^create extension .*$/gm, '');

test('due letters get one push, retrieved and future ones none', async () => {
  const db = new PGlite();
  await db.exec(STUBS);
  await db.exec(read('20261026000001_letters.sql'));
  await db.exec(withoutExtensions(read('20261026000002_delivery_push.sql')));

  const A = '00000000-0000-0000-0000-00000000000a';
  const B = '00000000-0000-0000-0000-00000000000b';
  const C = '00000000-0000-0000-0000-0000000000cc';
  await db.exec(`
    insert into auth.users values ('${A}'), ('${B}');
    insert into public.couples (id) values ('${C}');
    insert into public.profiles (id, couple_id, display_name, city) values ('${A}', '${C}', 'N', 'Paris'), ('${B}', '${C}', 'M', 'Moscou');
    insert into public.letters (id, couple_id, sender_id, recipient_id, tier, posted_at, collect_at, deliver_at, retrieved_at, seed) values
      ('00000000-0000-0000-0000-000000000001', '${C}', '${A}', '${B}', 'express', now() - interval '3 h', now() - interval '2 h', now() - interval '1 min', null, 1),
      ('00000000-0000-0000-0000-000000000002', '${C}', '${A}', '${B}', 'express', now() - interval '3 h', now() - interval '2 h', now() - interval '1 min', now() - interval '150 min', 2),
      ('00000000-0000-0000-0000-000000000003', '${C}', '${A}', '${B}', 'express', now(), now() + interval '1 h', now() + interval '3 h', null, 3);
  `);

  const first = await db.query<{ n: number }>('select public.dispatch_deliveries() as n');
  assert.equal(first.rows[0].n, 1);
  const second = await db.query<{ n: number }>('select public.dispatch_deliveries() as n');
  assert.equal(second.rows[0].n, 0, 'idempotent: no second push');

  const reqs = await db.query<{ url: string; headers: Record<string, string>; body: { letter_ids: string[] } }>('select * from net.requests');
  assert.equal(reqs.rows.length, 1);
  assert.equal(reqs.rows[0].url, 'https://ref.supabase.co/functions/v1/deliver');
  assert.equal(reqs.rows[0].headers.authorization, 'Bearer srk');
  assert.deepEqual(reqs.rows[0].body.letter_ids, ['00000000-0000-0000-0000-000000000001']);

  const jobs = await db.query<{ name: string; schedule: string }>('select * from cron.jobs');
  assert.deepEqual(jobs.rows.map((j) => [j.name, j.schedule]), [['deliver-mail', '* * * * *']]);
  await db.close();
});
