import { test } from 'node:test';
import assert from 'node:assert/strict';

import { layoutHandwriting } from '../src/letter/handwriting';

// Monospace stand-in for a font: 10 px per character.
const measure = (w: string) => w.length * 10;
const opts = { seed: 42, fontSize: 20, left: 0, top: 40, maxWidth: 200, lineHeight: 30 };

test('same seed gives an identical layout (both phones render the same sheet)', () => {
  const text = 'Моя хорошая,\n    пишу тебе вечером. Je pense à toi, mon cœur.';
  assert.deepEqual(layoutHandwriting(text, measure, opts), layoutHandwriting(text, measure, opts));
  assert.notDeepEqual(
    layoutHandwriting(text, measure, opts).words,
    layoutHandwriting(text, measure, { ...opts, seed: 43 }).words,
  );
});

test('words stay whole and in order; nothing is lost', () => {
  const text = 'один два три четыре пять шесть семь восемь девять десять';
  const { words } = layoutHandwriting(text, measure, opts);
  assert.equal(words.map((w) => w.text).join(' '), text);
});

test('wraps at maxWidth and keeps jitter subtle', () => {
  const { words, lines } = layoutHandwriting('aaaa bbbb cccc dddd eeee ffff gggg hhhh', measure, opts);
  assert.ok(lines > 1);
  for (const w of words) {
    assert.ok(w.x + w.text.length * 10 * w.scale <= opts.maxWidth + 12, `${w.text} overflows`);
    assert.ok(Math.abs(w.rotation) < (2.5 * Math.PI) / 180, 'rotation stays within a few degrees');
    assert.ok(w.opacity >= 0.8 && w.opacity <= 1, 'ink load stays in range');
    assert.ok(Math.abs(w.y - (opts.top + w.line * opts.lineHeight)) < 4, 'baseline stays near its line');
  }
});

test('leading spaces indent a paragraph, wrapped lines start at the margin', () => {
  const { words } = layoutHandwriting('первый\n    второй абзац длинный длинный длинный', measure, opts);
  const second = words.find((w) => w.text === 'второй')!;
  assert.ok(second.x > 25, 'paragraph is indented');
  const wrapped = words.filter((w) => w.line > second.line);
  assert.ok(wrapped.length > 0 && wrapped[0].x < 6, 'continuation line starts at the margin');
});

test('reports overflow when the sheet is full, at the right source index', () => {
  const text = 'раз\nдва\nтри\nчетыре';
  const res = layoutHandwriting(text, measure, { ...opts, maxLines: 2 });
  assert.equal(res.words.length, 2);
  assert.equal(text.slice(res.overflowAt).trim(), 'три\nчетыре');
});

for (const kind of ['grid', 'seyes', 'airmail'] as const) {
  test(`a face filled at the desk never loses words when the reader lays it out at another width (${kind})`, async () => {
    const { writingArea } = await import('../src/letter/paperLayout');
    // As sheet.ts's paperFor and fontSizeFor scale them (that file needs react-native).
    const ruling = kind === 'airmail' ? ('none' as const) : kind;
    const cellOf = (w: number) => (kind === 'grid' ? w / 30 : kind === 'seyes' ? w / 15 : 0);
    const fontOf = (w: number) => (kind === 'grid' ? (w / 30) * 1.5 : kind === 'seyes' ? (w / 15) * 0.75 : w / 21);
    const paper = (w: number) => ({ kind, ruling, cell: cellOf(w), base: [1, 1, 1] as const, marginX: 0, gridColor: [0, 0, 0] as const, marginColor: [0, 0, 0] as const, bleed: 0, showThrough: 0, ghostBlur: 0 });
    const layoutAt = (text: string, w: number, extraLines: number, seed: number) => {
      const p = paper(w);
      const fontSize = fontOf(w);
      const area = writingArea(p, { width: w, height: Math.round(w * Math.SQRT2) }, fontSize);
      // A proportional-ish stand-in for the font, scaled with the sheet.
      const m = (word: string) => [...word].reduce((s, c) => s + (/[mwшщжыюМШЩЖ]/.test(c) ? 0.8 : /[iljtf.,]/.test(c) ? 0.28 : 0.52), 0) * fontSize;
      return layoutHandwriting(text, m, { seed, fontSize, ...area, maxLines: area.maxLines + extraLines });
    };
    const words = 'пишу тебе вечером за окном шуршит дождь а чай уже остыл je pense à toi mon cœur voix ambiguë'.split(' ');
    for (const seed of [1, 7, 1407, 99991]) {
      // Fill the desk's sheet to its last line, as a writer would.
      let text = '';
      for (let i = 0; ; i++) {
        const next = text + (i ? ' ' : '') + words[i % words.length] + (i % 23 === 22 ? '\n' : '');
        if (layoutAt(next, 520, 0, seed).overflowAt >= 0) break;
        text = next;
      }
      for (const w of [335, 409, 440, 520]) assert.equal(layoutAt(text, w, 1, seed).overflowAt, -1, `seed ${seed}, ${w} px`);
    }
  });
}
