import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { countryOf, mailboxFromServer, type MailRow } from '../src/letter/mailboxFromServer';

/** What RLS hands the recipient becomes the letters in their mailbox. */

const me = { id: 'b', display_name: 'М.', city: 'Minsk', tz: 'Europe/Minsk' };
const them = { id: 'a', display_name: 'Н.', city: 'Lille', tz: 'Europe/Paris' };
const now = Date.parse('2026-11-20T12:00:00Z');
const row = (id: string, deliver: string, extra: Partial<MailRow> = {}): MailRow => ({
  id,
  sender_id: 'a',
  recipient_id: 'b',
  deliver_at: deliver,
  retrieved_at: null,
  seed: 7,
  envelope: { paper: 'kraft', wax: 'navy', initials: 'Н', seed: 11, postmark: { city: 'Lille', date: '2026-11-03' } },
  ...extra,
});

describe('mailboxFromServer', () => {
  const rows = [
    row('late', '2026-11-19T13:00:00Z'),
    row('early', '2026-11-18T07:00:00Z'),
    row('read', '2026-11-10T07:00:00Z'),
    row('future', '2026-11-25T07:00:00Z'),
    row('mine', '2026-11-01T07:00:00Z', { sender_id: 'b', recipient_id: 'a' }),
    row('taken back', '2026-11-11T07:00:00Z', { retrieved_at: '2026-11-03T10:00:00Z' }),
  ];
  const contents = [
    { letter_id: 'early', body: { text: 'Привет', font: 'caveat', ink: 'violet', paper: 'grid', strokes: [[[1, 2, 0.5, 0]]], sheet_width: 320 } },
    { letter_id: 'late', body: { text: 'Coucou', font: 'comic sans', ink: 'red' } },
    { letter_id: 'read', body: { text: 'Old' } },
  ];
  const receipts = [{ letter_id: 'read', opened_at: '2026-11-10T09:00:00Z' }];
  const box = mailboxFromServer({ rows: rows as MailRow[], contents: contents as never, receipts, me, them, now });

  test('waiting: delivered, unopened, to me, oldest first; the next delivery is known', () => {
    assert.deepEqual(box.waiting.map((l) => l.id), ['early', 'late']);
    assert.deepEqual(box.opened.map((l) => l.id), ['read']);
    assert.equal(box.nextAt, Date.parse('2026-11-25T07:00:00Z'));
  });

  test('envelope and sheet come from the server, unknown values fall back', () => {
    const [early, late] = box.waiting;
    assert.equal(early.seed, 11);
    assert.equal(early.paper, 'kraft');
    assert.equal(early.wax, 'navy');
    assert.deepEqual(early.letterLook, { paper: 'grid', ink: 'violet', font: 'caveat' });
    assert.equal(early.strokes?.length, 1);
    assert.equal(early.strokesWidth, 320);
    assert.deepEqual(late.letterLook, { paper: 'cotton', ink: 'blueBlack', font: 'badScript' });
    assert.equal(late.strokes, undefined);
  });

  test('addressed from Lille to Minsk, in French, with the real postmark', () => {
    const l = box.waiting[0];
    assert.deepEqual(l.address, { fromName: 'Н.', fromCity: 'Lille', toName: 'М.', toCity: 'Minsk', toCountry: 'Biélorussie' });
    assert.deepEqual(l.postmark, { city: 'Lille', date: '2026-11-03' });
    assert.equal(l.senderCountry, 'fr');
    assert.equal(countryOf(me.tz), 'ru');
  });
});
