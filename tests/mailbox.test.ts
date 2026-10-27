import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { countryOf, mailboxFromServer, parseSheets, sheetsOf, type MailRow } from '../src/letter/mailboxFromServer';
import { parseSeal, presetSeal, sealFromPx, sealToPx, type SealPlacement } from '../src/letter/seal';

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
    { letter_id: 'early', body: { text: 'Привет', font: 'caveat', ink: 'violet', paper: 'grid', strokes: [[[1, 2, 0.5, 0]]], sheet_width: 320, fold: 'quarter' } },
    { letter_id: 'late', body: { text: 'Coucou', font: 'comic sans', ink: 'red', fold: 'origami crane' } },
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
    // Unfolded the way it was folded; anything unknown is a tri-fold.
    assert.equal(early.fold, 'quarter');
    assert.equal(late.fold, 'tri');
    // The envelope matches the fold unless the posting recorded one.
    assert.equal(early.format, 'C6');
    assert.equal(late.format, 'DL');
    const recorded = mailboxFromServer({
      rows: [row('c5', '2026-11-19T13:00:00Z', { envelope: { format: 'C5' } })],
      contents: [],
      receipts: [],
      me,
      them,
      now,
    });
    assert.equal(recorded.waiting[0].format, 'C5');
  });

  test('an envelope seed that is not an integer falls back to the row seed', () => {
    for (const seed of ['abc', 1.5, null, Number.NaN, { n: 1 }, [3], '11']) {
      const got = mailboxFromServer({
        rows: [row('x', '2026-11-19T13:00:00Z', { envelope: { seed } as never })],
        contents: [],
        receipts: [],
        me,
        them,
        now,
      });
      assert.equal(got.waiting[0].seed, 7, `seed ${JSON.stringify(seed)}`);
    }
  });

  test('addressed from Lille to Minsk, in French, with the real postmark', () => {
    const l = box.waiting[0];
    assert.deepEqual(l.address, { fromName: 'Н.', fromCity: 'Lille', toName: 'М.', toCity: 'Minsk', toCountry: 'Biélorussie' });
    assert.deepEqual(l.postmark, { city: 'Lille', date: '2026-11-03' });
    assert.equal(l.senderCountry, 'fr');
    assert.equal(countryOf(me.tz), 'ru');
  });

  test('the seal, the die and the liner come through; old letters keep today\'s seal', () => {
    const left = presetSeal('left', 'DL', 11);
    const placed: SealPlacement = {
      ...left,
      stretch: [0.2, -0.1],
      drops: [[0.41, 0.3, 1.5]],
      stamp: { ...left.stamp!, x: left.x + 0.02, rot: 0.4, depth: 0.6 },
    };
    // What the sender's ceremony stores: sealFromPx output, sent as JSON.
    const stored = JSON.parse(JSON.stringify(sealFromPx(sealToPx(placed, 340, 170, 'DL', 11), 340, 170, 'DL')));
    const box = (envelope: MailRow['envelope']) =>
      mailboxFromServer({ rows: [row('x', '2026-11-19T13:00:00Z', { envelope })], contents: [], receipts: [], me, them, now }).waiting[0];

    const sealed = box({ seed: 11, liner: 'forest', die: 'lily', seal: stored });
    assert.deepEqual(sealed.seal, parseSeal(stored));
    assert.ok(Math.abs(sealed.seal!.x - placed.x) < 1e-9 && Math.abs(sealed.seal!.stamp!.rot - 0.4) < 1e-9);
    assert.deepEqual(sealed.seal!.drops, stored.drops);
    assert.equal(sealed.die, 'lily');
    assert.equal(sealed.liner, 'forest');

    // A legacy row: no seal (the ceremony draws defaultSeal), the monogram, the postal liner.
    const legacy = box({ paper: 'kraft', wax: 'navy', initials: 'Н', seed: 11 });
    assert.equal(legacy.seal, undefined);
    assert.equal(legacy.die, 'monogram');
    assert.equal(legacy.liner, 'postal');

    // Garbage never reaches the renderer.
    for (const seal of [
      'tip',
      42,
      [0.5, 0.5],
      { v: 2, x: 0.5, y: 0.5, rMm: 18, stamp: null },
      { v: 1, x: 'left', y: 0.5, rMm: 18, stamp: null },
      { v: 1, x: Number.NaN, y: 0.5, rMm: 18, stamp: null },
      { v: 1, x: 9, y: 0.5, rMm: 18, stamp: null },
      { v: 1, x: 0.5, y: 0.5, rMm: 18, stamp: 5 },
      { v: 1, x: 0.5, y: 0.5, rMm: 18, stamp: null, drops: [[0.1, 0.1, 1], [0.2, 0.2, 1], [0.3, 0.3, 1]] },
    ]) {
      assert.equal(box({ seed: 11, seal }).seal, undefined, JSON.stringify(seal));
    }
    const odd = box({ seed: 11, die: 'pahonia', liner: 'velvet' } as MailRow['envelope']);
    assert.equal(odd.die, 'monogram');
    assert.equal(odd.liner, 'postal');
    assert.equal(box({ seed: 11, die: 'toString' }).die, 'monogram');
  });
});

describe('sheets of a letter', () => {
  const pen = [[1, 2, 0.5, 0]];
  test('schema_v 1 is one sheet with a blank back', () => {
    const [only, ...rest] = parseSheets({ text: 'Привет', strokes: [pen] as never });
    assert.equal(rest.length, 0);
    assert.deepEqual(only, { recto: { text: 'Привет', strokes: [pen] }, verso: { text: '', strokes: [] }, twoSided: false });
    assert.deepEqual(parseSheets(null), [{ recto: { text: '', strokes: [] }, verso: { text: '', strokes: [] }, twoSided: false }]);
  });

  test('schema_v 2: sheet 1 from the top level, the rest from sheets[]', () => {
    const sheets = parseSheets({ text: 'раз', schema_v: 2, sheets: [{ verso: { text: 'два' } }, { recto: { text: 'три', strokes: [pen] } }] });
    assert.deepEqual(
      sheets.map((s) => [s.recto.text, s.verso.text, s.recto.strokes.length, s.twoSided]),
      [['раз', 'два', 0, true], ['три', '', 1, false]],
    );
  });

  test('never trusts the shape: junk is dropped, numbers are not text, at most four sheets', () => {
    assert.equal(parseSheets({ text: 'a', sheets: { recto: {} } }).length, 1);
    const junk = parseSheets({ text: 7 as never, strokes: 'x' as never, sheets: [{ verso: 'no' }, 'page', { recto: { text: 5, strokes: [1, pen] } }, null, { verso: {} }] });
    assert.deepEqual(
      junk.map((s) => [s.recto.text, s.recto.strokes.length, s.verso.text]),
      [['', 0, ''], ['', 1, '']],
    );
    const many = Array.from({ length: 9 }, (_, i) => ({ recto: { text: String(i) } }));
    assert.equal(parseSheets({ text: 'x', sheets: [{}, ...many] }).length, 4);
  });

  test('the mailbox keeps every sheet and the seed the desk wrote with', () => {
    const box = mailboxFromServer({
      rows: [row('long', '2026-11-19T13:00:00Z')],
      contents: [{ letter_id: 'long', body: { text: 'раз', seed: 42, sheets: [{ verso: { text: 'два' } }] } }],
      receipts: [],
      me,
      them,
      now,
    });
    const [l] = box.waiting;
    assert.equal(l.seed, 11, 'the envelope keeps its own seed');
    assert.equal(l.sheetSeed, 42);
    assert.equal(l.text, 'раз');
    assert.deepEqual(sheetsOf(l).map((s) => s.verso.text), ['два']);
    // A lab letter with only text is one sheet.
    assert.deepEqual(sheetsOf({ text: 'lab' }).map((s) => s.recto.text), ['lab']);
  });
});
