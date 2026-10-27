import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bodyBytes, draftBody, draftFirstText, isEmptyDraft, type Draft } from '../src/lib/draft';
import { parseSheets } from '../src/letter/mailboxFromServer';
import type { SheetContent } from '../src/letter/stack';

/** What the desk sends: one face exactly as before (schema_v 1), more sheets as schema_v 2. */

const look = { paper: 'grid' as const, ink: 'blueBlack' as const, font: 'badScript' as const, seed: 99 };
const pen = [[1.25, 2.04, 0.5, 0]] as [number, number, number, number][];
const face = (text: string, strokes = [] as typeof pen[]) => ({ text, strokes });
const draft = (sheets: SheetContent[], fold?: Draft['fold']): Draft => ({ sheets, sheetWidth: 400, look, fold });
const sheet = (recto: string, verso = '', twoSided = true): SheetContent => ({ recto: face(recto), verso: face(verso), twoSided });

test('a one-face letter is the schema_v 1 body, plus the seed it was written with', () => {
  const body = draftBody(draft([{ recto: face('Привет', [pen]), verso: face(''), twoSided: true }, sheet('')]));
  assert.deepEqual(body, { text: 'Привет', strokes: [[[1.3, 2, 0.5, 0]]], sheet_width: 400, font: 'badScript', ink: 'blueBlack', paper: 'grid', fold: 'tri', seed: 99 });
});

test('more faces: sheet 1 recto stays on top, the rest in sheets[], blank backs and trailing sheets dropped', () => {
  const body = draftBody(draft([sheet('один', 'два'), sheet('три'), sheet('четыре', 'пять'), sheet('')], 'half'));
  assert.equal(body.text, 'один');
  assert.equal(body.schema_v, 2);
  assert.equal(body.fold, 'half');
  assert.deepEqual(body.sheets, [
    { verso: face('два') },
    { recto: face('три') },
    { recto: face('четыре'), verso: face('пять') },
  ]);
});

test('a back the writer turned off is never sent', () => {
  const body = draftBody(draft([sheet('лицо', 'забытое', false)]));
  assert.equal(body.sheets, undefined);
});

test('what is sent is what is read', () => {
  const sheets = [sheet('один', 'два'), sheet('три', ''), sheet('четыре', 'пять')];
  const read = parseSheets(draftBody(draft(sheets)) as never);
  assert.deepEqual(
    read.map((s) => [s.recto.text, s.verso.text, s.twoSided]),
    [['один', 'два', true], ['три', '', false], ['четыре', 'пять', true]],
  );
});

test('empty means every face of every sheet is blank', () => {
  assert.equal(isEmptyDraft(null), true);
  assert.equal(isEmptyDraft(draft([sheet(' '), sheet('')])), true);
  assert.equal(isEmptyDraft(draft([sheet(''), sheet('', 'на обороте')])), false);
  assert.equal(draftFirstText(draft([sheet(''), sheet('', 'на обороте')])), 'на обороте');
});

test('size is counted in UTF-8 bytes, as the server does', () => {
  assert.equal(bodyBytes({ t: 'ё' }), JSON.stringify({ t: 'ё' }).length + 1);
});
