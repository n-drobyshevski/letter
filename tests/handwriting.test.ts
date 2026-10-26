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
