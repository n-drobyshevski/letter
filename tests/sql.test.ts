import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * Runs the real migration in an in-process Postgres (PGlite) with a minimal
 * stand-in for Supabase's `auth` schema, then checks the delivery algorithm and RLS.
 */

const migration = (f: string) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8');
// 0002 needs Supabase-only extensions; it is covered by dispatch.test.ts.
const MIGRATIONS = ['20261026000001_letters.sql', '20261027000003_collection_visibility.sql'].map(migration);

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
`;

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';

let db: PGlite;

async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(user ? `set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);` : 'reset role;');
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];

before(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const m of MIGRATIONS) await db.exec(m);
  await db.exec(`
    grant select, update on all tables in schema public to authenticated;
    grant insert, delete on public.devices to authenticated;
    insert into auth.users values ('${A}'), ('${B}');
    insert into public.couples (id) values ('00000000-0000-0000-0000-0000000000cc');
    insert into public.profiles (id, couple_id, display_name, city, lat, lon, tz, locale) values
      ('${A}', '00000000-0000-0000-0000-0000000000cc', 'N', 'Paris', 48.8566, 2.3522, 'Europe/Paris', 'fr'),
      ('${B}', '00000000-0000-0000-0000-0000000000cc', 'M', 'Moscou', 55.7558, 37.6173, 'Europe/Moscow', 'ru');
  `);
});

after(async () => db?.close());

const round = async (after: string, tz = 'Europe/Paris') =>
  (await one<{ r: Date }>(`select public.next_post_round($1::timestamptz, $2) as r`, [after, tz])).r.toISOString();

describe('post rounds (10:00 / 16:00 local, no Sundays)', () => {
  test('snaps forward to the next round', async () => {
    // Monday 2026-10-19, Paris is UTC+2 (summer time)
    assert.equal(await round('2026-10-19T09:00:00+02:00'), '2026-10-19T08:00:00.000Z');
    assert.equal(await round('2026-10-19T10:00:00+02:00'), '2026-10-19T08:00:00.000Z', 'exactly on a round');
    assert.equal(await round('2026-10-19T12:00:00+02:00'), '2026-10-19T14:00:00.000Z');
    assert.equal(await round('2026-10-19T16:30:00+02:00'), '2026-10-20T08:00:00.000Z', 'next morning');
  });

  test('skips Sunday', async () => {
    assert.equal(await round('2026-10-17T17:00:00+02:00'), '2026-10-19T08:00:00.000Z', 'Sat evening → Mon 10:00');
  });

  test('handles the end of summer time (Paris, 25 Oct 2026)', async () => {
    // Sat 24 Oct 17:00 CEST → Mon 26 Oct 10:00 CET = 09:00 UTC
    assert.equal(await round('2026-10-24T17:00:00+02:00'), '2026-10-26T09:00:00.000Z');
  });

  test('uses the recipient time zone', async () => {
    // 07:30 UTC is 10:30 in Moscow → 16:00 MSK = 13:00 UTC
    assert.equal(await round('2026-10-19T07:30:00Z', 'Europe/Moscow'), '2026-10-19T13:00:00.000Z');
  });
});

describe('compute_deliver_at', () => {
  const deliver = async (tier: string, posted: string, km: number | null, jitter = 0, date: string | null = null) =>
    (
      await one<{ d: Date }>(`select public.compute_deliver_at($1, $2::timestamptz, 'Europe/Paris', $3, $4::date, $5) as d`, [
        tier,
        posted,
        km,
        date,
        jitter,
      ])
    ).d.toISOString();

  test('express: next round at least two hours later', async () => {
    assert.equal(await deliver('express', '2026-10-19T09:00:00+02:00', 2500), '2026-10-19T14:00:00.000Z');
    assert.equal(await deliver('express', '2026-10-19T15:00:00+02:00', 2500), '2026-10-20T08:00:00.000Z');
  });

  test('standard: distance-aware, clamped to 12–72 h, then the next round', async () => {
    // Paris→Moscow ~2490 km → ~62 h → Wed 23:xx → Thu 10:00 CEST
    assert.equal(await deliver('standard', '2026-10-19T09:00:00+02:00', 2490), '2026-10-22T08:00:00.000Z');
    // short hop → floor of 12 h → Mon 21:00 → Tue 10:00
    assert.equal(await deliver('standard', '2026-10-19T09:00:00+02:00', 5), '2026-10-20T08:00:00.000Z');
    // unknown distance → default 24 h → Tue 09:00 → Tue 10:00
    assert.equal(await deliver('standard', '2026-10-19T09:00:00+02:00', null), '2026-10-20T08:00:00.000Z');
  });

  test('standard: jitter never moves a letter by more than ±15 % before rounding', async () => {
    const posted = Date.parse('2026-10-19T09:00:00+02:00');
    for (const j of [-0.15, 0, 0.15]) {
      const d = Date.parse(await deliver('standard', '2026-10-19T09:00:00+02:00', 2490, j));
      const hours = (d - posted) / 3.6e6;
      assert.ok(hours >= 2490 / 40 * 0.85 && hours <= 2490 / 40 * 1.15 + 18 + 24, `jitter ${j}: ${hours} h`);
    }
    await assert.rejects(deliver('standard', '2026-10-19T09:00:00+02:00', 2490, 0.5), /jitter out of range/);
  });

  test('scheduled: 10:00 local on the chosen day, never in the near past', async () => {
    assert.equal(
      await deliver('scheduled', '2026-10-19T09:00:00+02:00', 2490, 0, '2027-02-14'),
      '2027-02-14T09:00:00.000Z',
      "Valentine's day, 10:00 CET",
    );
    await assert.rejects(deliver('scheduled', '2026-10-19T09:00:00+02:00', 2490, 0, '2026-10-19'), /at least 2 hours/);
    await assert.rejects(deliver('scheduled', '2026-10-19T09:00:00+02:00', 2490, 0, null), /need a date/);
  });
});

describe('row-level security', () => {
  let letterId: string;

  test('the sender posts; the server stamps postmark and delivery time', async () => {
    const letter = await as(A, () =>
      one<{ id: string; deliver_at: Date; collect_at: Date; posted_at: Date; envelope: { postmark: { city: string } }; recipient_id: string }>(
        `select * from public.post_letter('express', '{"text":"Je pense à toi"}'::jsonb, '{"stamp":"tour-eiffel"}'::jsonb, 1407)`,
      ),
    );
    letterId = letter.id;
    assert.equal(letter.recipient_id, B);
    assert.equal(letter.envelope.postmark.city, 'Paris');
    assert.ok(letter.deliver_at.getTime() - letter.posted_at.getTime() >= 2 * 3.6e6);
    assert.equal(letter.collect_at.getTime() - letter.posted_at.getTime(), 3.6e6, 'one-hour grace window');
  });

  test('clients cannot write letters or pick their own delivery time', async () => {
    await assert.rejects(
      as(B, () => db.query(`insert into public.letters (couple_id, sender_id, recipient_id, tier, collect_at, deliver_at, seed)
        values ('00000000-0000-0000-0000-0000000000cc', '${B}', '${A}', 'express', now(), now(), 1)`)),
    );
    await as(A, () => db.query(`update public.letters set deliver_at = now() where id = $1`, [letterId]));
    const r = await one<{ d: Date; p: Date }>(`select deliver_at d, posted_at p from public.letters where id = $1`, [letterId]);
    assert.ok(r.d.getTime() - r.p.getTime() >= 2 * 3.6e6, 'update had no effect (no update policy)');
  });

  test('still in the postbox: the recipient knows nothing yet', async () => {
    assert.equal((await as(B, () => db.query(`select id from public.letters`))).rows.length, 0);
    assert.equal((await as(B, () => db.query(`select * from public.letter_contents`))).rows.length, 0);
    const status = await as(A, () => one<{ status: string }>(`select status from public.letter_status`));
    assert.equal(status.status, 'posted');
  });

  test('collected: the recipient sees the envelope in transit, not the contents', async () => {
    await db.query(`update public.letters set posted_at = now() - interval '2 hours', collect_at = now() - interval '1 hour' where id = $1`, [letterId]);
    const collected = await one<{ n: number }>(`select public.collect_posted() as n`);
    assert.equal(collected.n, 1, 'collection is written, so Realtime fires');
    assert.equal((await one<{ n: number }>(`select public.collect_posted() as n`)).n, 0, 'idempotent');

    const envelopes = await as(B, () => db.query(`select id from public.letters`));
    assert.equal(envelopes.rows.length, 1);
    const contents = await as(B, () => db.query(`select * from public.letter_contents`));
    assert.equal(contents.rows.length, 0);
    const own = await as(A, () => db.query(`select * from public.letter_contents`));
    assert.equal(own.rows.length, 1, 'the sender can always reread what they wrote');
    const status = await as(B, () => one<{ status: string }>(`select status from public.letter_status`));
    assert.equal(status.status, 'in_transit');
    await assert.rejects(as(B, () => db.query(`select public.open_letter($1)`, [letterId])), /not delivered/);
  });

  test('after deliver_at the recipient can read and open it; receipts stay private by default', async () => {
    await db.query(`update public.letters set posted_at = now() - interval '3 hours', collect_at = now() - interval '2 hours', deliver_at = now() - interval '1 minute' where id = $1`, [letterId]);
    const contents = await as(B, () => db.query<{ body: { text: string } }>(`select body from public.letter_contents`));
    assert.equal(contents.rows[0].body.text, 'Je pense à toi');
    await as(B, () => db.query(`select public.open_letter($1, 'slit')`, [letterId]));
    await as(B, () => db.query(`select public.open_letter($1)`, [letterId])); // idempotent
    const receipts = await as(B, () => db.query<{ opened_by: string }>(`select opened_by from public.letter_receipts`));
    assert.deepEqual(receipts.rows.map((r) => r.opened_by), ['slit']);
    assert.equal((await as(A, () => db.query(`select * from public.letter_receipts`))).rows.length, 0);
    await db.exec(`update public.profiles set read_receipts = true`);
    assert.equal((await as(A, () => db.query(`select * from public.letter_receipts`))).rows.length, 1, 'both opted in');
    await db.exec(`update public.profiles set read_receipts = false`);
  });

  test('grace window: the sender can take a letter back, and then it vanishes for the recipient', async () => {
    const second = await as(A, () => one<{ id: string }>(`select id from public.post_letter('standard', '{"text":"oops"}', '{}', 2)`));
    await as(A, () => db.query(`select public.retrieve_letter($1)`, [second.id]));
    const seen = await as(B, () => db.query(`select id from public.letters where id = $1`, [second.id]));
    assert.equal(seen.rows.length, 0);
    await assert.rejects(as(A, () => db.query(`select public.retrieve_letter($1)`, [letterId])), /too late/);
    await assert.rejects(as(B, () => db.query(`select public.retrieve_letter($1)`, [second.id])), /too late/, 'only the sender');
  });

  test('strangers see nothing', async () => {
    const C = '00000000-0000-0000-0000-00000000000c';
    await db.exec(`insert into auth.users values ('${C}');
      insert into public.couples (id) values ('00000000-0000-0000-0000-0000000000dd');
      insert into public.profiles (id, couple_id, display_name, city) values ('${C}', '00000000-0000-0000-0000-0000000000dd', 'X', 'Lyon');`);
    for (const table of ['letters', 'letter_contents', 'letter_receipts', 'profiles']) {
      const rows = await as(C, () => db.query(`select * from public.${table}`));
      assert.equal(rows.rows.length, table === 'profiles' ? 1 : 0, table);
    }
  });
});
