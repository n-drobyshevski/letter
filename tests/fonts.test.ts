import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Every handwriting font we ship must cover Russian and French completely.
const FONTS = {
  'Bad Script': '@expo-google-fonts/bad-script/400Regular/BadScript_400Regular.ttf',
  'Marck Script': '@expo-google-fonts/marck-script/400Regular/MarckScript_400Regular.ttf',
  Caveat: '@expo-google-fonts/caveat/400Regular/Caveat_400Regular.ttf',
};
const RU = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ«»—№';
const FR = 'àâæçéèêëîïôœùûüÿÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸ’';

test('handwriting fonts cover every Russian and French character', async () => {
  const init = require('canvaskit-wasm/bin/full/canvaskit.js');
  const CK = await init({ locateFile: (f: string) => require.resolve(`canvaskit-wasm/bin/full/${f}`) });
  for (const [name, file] of Object.entries(FONTS)) {
    const bytes = readFileSync(require.resolve(file));
    const face = CK.Typeface.MakeTypefaceFromData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.ok(face, `${name} failed to load`);
    const font = new CK.Font(face, 20);
    const chars = [...(RU + FR)];
    const ids: Uint16Array = font.getGlyphIDs(chars.join(''));
    const missing = chars.filter((_, i) => ids[i] === 0);
    assert.deepEqual(missing, [], `${name} is missing glyphs`);
  }
});
