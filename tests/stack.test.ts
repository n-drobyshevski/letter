import { test } from 'node:test';
import assert from 'node:assert/strict';

import { paperUniforms, writingArea } from '../src/letter/paperLayout';
import {
  bulgeFor,
  emptyFace,
  inkSeed,
  maxSheetsFor,
  packetMm,
  paperSeed,
  quantizeStroke,
  rescaleStrokes,
  sheetJitter,
  withFace,
  writtenFaces,
  type SheetContent,
} from '../src/letter/stack';

/** A letter as a stack of sheets, each with a front and a back. */

const face = (text: string) => ({ text, strokes: [] });
const sheet = (recto: string, verso = '', twoSided = verso !== ''): SheetContent => ({ recto: face(recto), verso: face(verso), twoSided });

test('read in writing order: every front, a back only when written', () => {
  const faces = writtenFaces([sheet('1', '2'), sheet('3'), sheet('', '6')]);
  assert.deepEqual(faces, [
    { sheet: 0, side: 'recto' },
    { sheet: 0, side: 'verso' },
    { sheet: 1, side: 'recto' },
    { sheet: 2, side: 'recto' },
    { sheet: 2, side: 'verso' },
  ]);
});

test('sheet 1 recto keeps the letter seed; every other face and sheet gets its own', () => {
  assert.equal(inkSeed(1407, { sheet: 0, side: 'recto' }), 1407);
  assert.equal(paperSeed(1407, 0), 1407);
  const seeds = [0, 1, 2, 3].flatMap((s) => (['recto', 'verso'] as const).map((side) => inkSeed(1407, { sheet: s, side })));
  assert.equal(new Set(seeds).size, 8);
  assert.notEqual(paperSeed(1407, 1), paperSeed(1407, 2));
  assert.equal(inkSeed(1407, { sheet: 2, side: 'verso' }), inkSeed(1407, { sheet: 2, side: 'verso' }), 'deterministic');
});

test('a stack never lines up exactly, but only by a hair', () => {
  assert.deepEqual(sheetJitter(5, 0), { dx: 0, dy: 0, rot: 0 });
  for (let i = 1; i < 4; i++) {
    const j = sheetJitter(5, i);
    assert.ok(Math.abs(j.dx) <= 1.5 && Math.abs(j.dy) <= 1.5 && Math.abs(j.rot) <= (0.5 * Math.PI) / 180);
  }
});

test('four sheets fit an envelope, two once folded in four', () => {
  assert.equal(maxSheetsFor('tri'), 4);
  assert.equal(maxSheetsFor('half'), 4);
  assert.equal(maxSheetsFor('quarter'), 2);
});

test('replacing one face leaves the others alone', () => {
  const before = [sheet('a', 'b'), sheet('c')];
  const after = withFace(before, { sheet: 1, side: 'verso' }, face('d'));
  assert.equal(after[1].verso.text, 'd');
  assert.equal(after[0], before[0]);
  assert.deepEqual(before[1].verso, emptyFace());
});

test('strokes are stored rounded', () => {
  assert.deepEqual(quantizeStroke([[10.234, 5.06, 0.5555, 16.7]]), [[10.2, 5.1, 0.56, 17]]);
});

test('a notebook verso has its margin on the outer edge: the writing area mirrors', () => {
  const grid = { kind: 'grid' as const, ruling: 'grid' as const, base: [1, 1, 1] as const, cell: 14, marginX: 0, gridColor: [0, 0, 0] as const, marginColor: [0, 0, 0] as const, bleed: 0, showThrough: 0.1, ghostBlur: 1 };
  const sheetSize = { width: 420, height: 594 };
  const r = writingArea(grid, sheetSize, 21, 'recto');
  const v = writingArea(grid, sheetSize, 21, 'verso');
  assert.ok(Math.abs(v.left - (sheetSize.width - (r.left + r.maxWidth))) < 1e-9);
  assert.ok(Math.abs(v.maxWidth - r.maxWidth) < 1e-9);
  assert.equal(v.maxLines, r.maxLines);
  const cotton = { ...grid, kind: 'cotton' as const, ruling: 'none' as const, cell: 0 };
  assert.deepEqual(writingArea(cotton, sheetSize, 21, 'verso'), writingArea(cotton, sheetSize, 21, 'recto'));
  // The side is the shader's last uniform; everything before it is unchanged.
  assert.deepEqual(paperUniforms(grid, sheetSize, 3, 1).slice(0, -1), paperUniforms(grid, sheetSize, 3, 1, 'tri', 'verso').slice(0, -1));
  assert.deepEqual([paperUniforms(grid, sheetSize, 3, 1).at(-1), paperUniforms(grid, sheetSize, 3, 1, 'tri', 'verso').at(-1)], [0, 1]);
});

test('Seyès is ruled the same on both faces, a line as tall as the notebook\'s; airmail lays out like cotton', () => {
  const sheetSize = { width: 420, height: 594 };
  const plain = { base: [1, 1, 1] as const, marginX: 0, gridColor: [0, 0, 0] as const, marginColor: [0, 0, 0] as const, bleed: 0, showThrough: 0.1, ghostBlur: 1 };
  const grid = { ...plain, kind: 'grid' as const, ruling: 'grid' as const, cell: sheetSize.width / 30 };
  const seyes = { ...plain, kind: 'seyes' as const, ruling: 'seyes' as const, marginSide: 'left' as const, cell: sheetSize.width / 15 };
  const airmail = { ...plain, kind: 'airmail' as const, ruling: 'none' as const, cell: 0, cockle: 1 };
  const cotton = { ...plain, kind: 'cotton' as const, cell: 0 };
  const font = sheetSize.width / 20;
  const r = writingArea(seyes, sheetSize, font, 'recto');
  assert.deepEqual(writingArea(seyes, sheetSize, font, 'verso'), r);
  const g = writingArea(grid, sheetSize, font, 'recto');
  assert.ok(Math.abs(r.lineHeight - g.lineHeight) < 1e-9, 'one Seyès pitch is two notebook cells');
  assert.equal(r.maxLines, g.maxLines, 'as many lines as the notebook');
  assert.ok(r.left > seyes.cell * 2, 'the writing starts right of the margin');
  // Baselines on the heavy lines.
  for (let i = 0; i < r.maxLines; i++) {
    const y = (r.top + i * r.lineHeight) / seyes.cell;
    assert.ok(Math.abs(y - Math.round(y)) < 1e-9);
  }
  assert.ok(r.top + (r.maxLines - 1) * r.lineHeight < sheetSize.height - seyes.cell * 0.5, 'the last line is on the sheet');
  for (const side of ['recto', 'verso'] as const)
    assert.deepEqual(writingArea(airmail, sheetSize, 21, side), writingArea(cotton, sheetSize, 21, side));
  // The margin is ruled on the screen for Seyès (left on both faces), on the sheet for the notebook.
  const MARGIN_SCREEN = -3;
  assert.equal(paperUniforms(seyes, sheetSize, 3, 1, 'tri', 'verso').at(MARGIN_SCREEN), 1);
  assert.equal(paperUniforms(grid, sheetSize, 3, 1, 'tri', 'verso').at(MARGIN_SCREEN), 0);
});

test('thinnest to thickest: airmail, notebook, Seyès, cotton', () => {
  const order = (['airmail', 'grid', 'seyes', 'cotton'] as const).map((p) => packetMm('tri', 1, p));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `${order}`);
});

test('the envelope bulges with the stack: flat for a sheet, round for four', () => {
  // Today's one-sheet letters lie flat in every fold.
  for (const fold of ['tri', 'half', 'quarter'] as const) for (const paper of ['grid', 'cotton'] as const) assert.equal(bulgeFor(fold, 1, paper), 0, `${fold} ${paper}`);
  assert.ok(Math.abs(packetMm('tri', 4, 'cotton') - 2.03) < 0.01, 'four cotton sheets in three: about 2 mm');
  // More sheets, more bulge; heavier paper bulges more than notebook paper.
  const cotton = [1, 2, 3, 4].map((n) => bulgeFor('tri', n, 'cotton'));
  for (let i = 1; i < 4; i++) assert.ok(cotton[i] > cotton[i - 1]);
  assert.ok(bulgeFor('tri', 4, 'grid') < bulgeFor('tri', 4, 'cotton'));
  assert.ok(cotton[3] > 0.8 && cotton[3] <= 1);
  // Folded in four, two sheets are as thick as more sheets folded in three.
  assert.ok(bulgeFor('quarter', 2, 'cotton') > bulgeFor('tri', 2, 'cotton'));
});

test('strokes follow the sheet when the window resizes it (laptop: 435 pt at 860, 364 at 760)', () => {
  const sheets: SheetContent[] = [
    {
      recto: { text: 'а', strokes: [[[435, 100, 0.5, 0], [217.5, 300, 0.6, 16]]] },
      verso: { text: '', strokes: [[[10, 20, 0.4, 0]]] },
      twoSided: true,
    },
  ];
  const k = 364 / 435;
  const out = rescaleStrokes(sheets, k);
  assert.deepEqual(out[0].recto.strokes[0][0], [364, 100 * k, 0.5, 0]);
  assert.deepEqual(out[0].recto.strokes[0][1], [182, 300 * k, 0.6, 16]);
  assert.deepEqual(out[0].verso.strokes[0][0], [10 * k, 20 * k, 0.4, 0]);
  assert.equal(out[0].recto.text, 'а');
  // Back to the first width: where it was drawn.
  const back = rescaleStrokes(out, 435 / 364);
  assert.ok(Math.abs(back[0].recto.strokes[0][1][0] - 217.5) < 1e-9);
  // Nothing to scale (no strokes, or the same width): the same array, so a sealed draft stays sealed.
  const typed: SheetContent[] = [{ recto: { text: 'а', strokes: [] }, verso: emptyFace(), twoSided: false }];
  assert.equal(rescaleStrokes(typed, k), typed);
  assert.equal(rescaleStrokes(sheets, 1), sheets);
});
