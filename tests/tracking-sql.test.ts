import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import { estimatedRouteT, generateItinerary, visibleAt } from '../src/letter/tracking/itinerary';

/** The tracking tables, written by the server, read by the couple through RLS. */

const migration = (f: string) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8');
const STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;

const A = '00000000-0000-0000-0000-00000000000a'; // in Lille
const B = '00000000-0000-0000-0000-00000000000b'; // in Minsk
const C = '00000000-0000-0000-0000-0000000000cc';
const D = '00000000-0000-0000-0000-00000000000d'; // signed in, not in the couple
let db: PGlite;

async function as<T>(role: string, user: string | null, fn: () => Promise<T>) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${user ?? ''}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

before(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const f of ['20261026000001_letters.sql', '20261027000003_collection_visibility.sql', '20261027000004_tier_postal.sql', '20261027000005_tracking.sql', '20261028000006_tracking_estimate.sql', '20261028000007_helpers_not_public.sql', '20261029000008_letter_sheets.sql', '20261029000009_envelope_seal.sql']) {
    await db.exec(migration(f));
  }
  await db.exec(`
    grant select on all tables in schema public to authenticated;
    insert into auth.users values ('${A}'), ('${B}'), ('${D}');
    insert into public.couples (id) values ('${C}');
    insert into public.profiles (id, couple_id, display_name, city, lat, lon, tz, locale) values
      ('${A}', '${C}', 'M', 'Lille', 50.637, 3.063, 'Europe/Paris', 'fr'),
      ('${B}', '${C}', 'N', 'Minsk', 53.9, 27.567, 'Europe/Minsk', 'ru');
  `);
});
after(async () => db?.close());

const post = async (seed: number) => {
  const collectAt = new Date(Date.now() + 30 * 60000);
  const it = generateItinerary({ seed, collectAt, tier: 'postal' });
  const row = await as('service_role', null, () =>
    db.query<{ id: string; deliver_at: Date; tracking: { s10: string } }>(
      `select id, deliver_at, tracking from public.record_posting($1, $2, $3, $4, $5, $6, $7, $8)`,
      [A, { text: 'Mon cœur' }, {}, seed, collectAt.toISOString(), it.deliverAt, { route: it.route, s10: it.s10, window: it.window }, JSON.stringify(it.events)],
    ),
  );
  return { it, letter: row.rows[0] };
};

/** Move a letter and its journey back in time by `days`, as if posted earlier. */
const age = (id: string, days: number) =>
  db.query(
    `update public.letters set posted_at = posted_at - make_interval(days => $2), collect_at = collect_at - make_interval(days => $2),
       deliver_at = deliver_at - make_interval(days => $2) where id = $1;
     `,
    [id, days],
  ).then(() => db.query(`update public.tracking_events set at = at - make_interval(days => $2) where letter_id = $1`, [id, days]));

describe('tracking', () => {
  test('the server records a postal letter whose delivery is its last scan', async () => {
    const { it, letter } = await post(1407);
    assert.equal(letter.deliver_at.toISOString(), new Date(it.deliverAt).toISOString());
    assert.equal(letter.tracking.s10, it.s10);
    const n = await db.query<{ n: number }>(`select count(*)::int n from public.tracking_events where letter_id = $1`, [letter.id]);
    assert.equal(n.rows[0].n, it.events.length);
  });

  test('clients cannot record itineraries, and broken itineraries are refused', async () => {
    const collectAt = new Date(Date.now() + 30 * 60000);
    const it = generateItinerary({ seed: 2, collectAt, tier: 'postal' });
    await assert.rejects(
      as('authenticated', A, () =>
        db.query(`select public.record_posting($1, '{}', '{}', 2, $2, $3, '{}', $4)`, [A, collectAt.toISOString(), it.deliverAt, JSON.stringify(it.events)]),
      ),
      /permission denied/,
    );
    const lying = it.events.map((e) => ({ ...e }));
    lying.at(-1)!.at = new Date(Date.parse(it.deliverAt) + 864e5).toISOString();
    await assert.rejects(
      as('service_role', null, () =>
        db.query(`select public.record_posting($1, '{}', '{}', 2, $2, $3, '{}', $4)`, [A, collectAt.toISOString(), it.deliverAt, JSON.stringify(lying)]),
      ),
      /outside|delivery/,
    );
    await assert.rejects(
      as('service_role', null, () =>
        db.query(`select public.record_posting($1, '{}', '{}', 2, $2, $3, '{}', $4)`, [A, new Date(Date.now() - 864e5).toISOString(), it.deliverAt, JSON.stringify(it.events)]),
      ),
      /collect_at/,
    );
  });

  test('each side sees the scans so far — the recipient only after collection, nobody the silent legs', async () => {
    const { it, letter } = await post(77);
    // Right after posting: nothing has happened yet.
    assert.equal((await as('authenticated', A, () => db.query(`select * from public.tracking_events where letter_id = $1`, [letter.id]))).rows.length, 0);

    // Eight days later.
    await age(letter.id, 8);
    const sender = await as('authenticated', A, () =>
      db.query<{ code: string; visible: boolean }>(`select code, visible from public.tracking_events where letter_id = $1 order by seq`, [letter.id]),
    );
    // Aging the letter by 8 days = looking at the original itinerary 8 days from now.
    const shouldSee = visibleAt(it, new Date(Date.now() + 8 * 864e5)).map((e) => e.code);
    assert.ok(shouldSee.length >= 3, `several scans by day 8 (${shouldSee.join(', ')})`);
    assert.deepEqual(sender.rows.map((r) => r.code), shouldSee, 'sender sees exactly the scans whose time has come');
    assert.ok(sender.rows.every((r) => r.visible), 'never a silent waypoint');

    const before = await as('authenticated', B, () => db.query(`select * from public.tracking_events where letter_id = $1`, [letter.id]));
    assert.equal(before.rows.length, 0, 'recipient: nothing until collected');
    await db.query(`select public.collect_posted()`);
    const afterCollect = await as('authenticated', B, () => db.query<{ code: string }>(`select code from public.tracking_events where letter_id = $1 order by seq`, [letter.id]));
    assert.deepEqual(afterCollect.rows.map((r) => r.code), shouldSee);
  });

  test('the server estimates where the letter is now from the silent legs too, for the couple only', async () => {
    const { it, letter } = await post(31);
    const estimate = (user: string) =>
      as('authenticated', user, () => db.query<{ e: number | null }>(`select public.tracking_estimate($1) e`, [letter.id])).then(
        (r) => r.rows[0].e,
      );
    assert.equal(await estimate(A), 0, 'still in the box: at the start of the route');

    await age(letter.id, 8);
    const at = new Date(Date.now() + 8 * 864e5);
    const expected = estimatedRouteT(it, at);
    const sender = await estimate(A);
    assert.ok(sender !== null && Math.abs(sender - expected) < 1e-3, `sender: ${sender} ≈ ${expected}`);
    assert.ok(sender! >= visibleAt(it, at).at(-1)!.routeT - 1e-4, 'never behind the last scan');

    assert.equal(await estimate(B), null, 'recipient: nothing before collection');
    assert.equal(await estimate(D), null, 'someone else: nothing');
    await assert.rejects(
      as('anon', null, () => db.query(`select public.tracking_estimate($1)`, [letter.id])),
      /permission denied/,
    );
    await db.query(`select public.collect_posted()`);
    const recipient = await estimate(B);
    assert.ok(recipient !== null && Math.abs(recipient - expected) < 1e-3);

    await age(letter.id, 60);
    assert.equal(await estimate(A), 1, 'delivered: at the end of the route');
  });

  test('reveal stamps each scan once (Realtime), and retrieval hides the journey', async () => {
    const stamped = await db.query<{ n: number }>(`select public.reveal_tracking() n`);
    assert.ok(stamped.rows[0].n > 0);
    assert.equal((await db.query<{ n: number }>(`select public.reveal_tracking() n`)).rows[0].n, 0, 'idempotent');

    const { letter } = await post(5);
    await as('authenticated', A, () => db.query(`select public.retrieve_letter($1)`, [letter.id]));
    // Days later, when its scans would have been due: neither of you sees the journey.
    await age(letter.id, 8);
    await db.query(`select public.collect_posted()`);
    for (const user of [A, B]) {
      const seen = await as('authenticated', user, () => db.query(`select 1 from public.tracking_events where letter_id = $1`, [letter.id]));
      assert.equal(seen.rows.length, 0);
      const est = await as('authenticated', user, () => db.query<{ e: number | null }>(`select public.tracking_estimate($1) e`, [letter.id]));
      assert.equal(est.rows[0].e, null);
    }
  });

  test('express and standard letters get a compressed itinerary that fits their promise', async () => {
    const r = await as('authenticated', A, () =>
      db.query<{ id: string; collect_at: Date; deliver_at: Date }>(`select id, collect_at, deliver_at from public.post_letter('express', '{}', '{}', 9)`),
    );
    const l = r.rows[0];
    const it = generateItinerary({ seed: 9, collectAt: l.collect_at, tier: 'express', deliverAt: l.deliver_at });
    await as('service_role', null, () => db.query(`select public.record_tracking($1, $2, $3)`, [l.id, { s10: it.s10 }, JSON.stringify(it.events)]));
    await assert.rejects(
      as('service_role', null, () => db.query(`select public.record_tracking($1, $2, $3)`, [l.id, { s10: it.s10 }, JSON.stringify(it.events)])),
      /already/,
    );
  });
});
