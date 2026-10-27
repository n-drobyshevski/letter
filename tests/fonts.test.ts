import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Every font we ship (handwriting and print) must cover Russian, Belarusian and French completely.
const FONTS = {
  'Bad Script': '@expo-google-fonts/bad-script/400Regular/BadScript_400Regular.ttf',
  'Marck Script': '@expo-google-fonts/marck-script/400Regular/MarckScript_400Regular.ttf',
  Caveat: '@expo-google-fonts/caveat/400Regular/Caveat_400Regular.ttf',
  'PT Sans Narrow': '@expo-google-fonts/pt-sans-narrow/400Regular/PTSansNarrow_400Regular.ttf',
  'PT Sans Narrow Bold': '@expo-google-fonts/pt-sans-narrow/700Bold/PTSansNarrow_700Bold.ttf',
};
const RU = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ«»—№';
// Belarusian, for the printed fields and postmarks of mail from Minsk.
const BY = 'іІўЎ';
const FR = 'àâæçéèêëîïôœùûüÿÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸ’';

test('handwriting fonts cover every Russian, Belarusian and French character', async () => {
  const init = require('canvaskit-wasm/bin/full/canvaskit.js');
  const CK = await init({ locateFile: (f: string) => require.resolve(`canvaskit-wasm/bin/full/${f}`) });
  for (const [name, file] of Object.entries(FONTS)) {
    const bytes = readFileSync(require.resolve(file));
    const face = CK.Typeface.MakeTypefaceFromData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.ok(face, `${name} failed to load`);
    const font = new CK.Font(face, 20);
    const chars = [...(RU + BY + FR)];
    const ids: Uint16Array = font.getGlyphIDs(chars.join(''));
    const missing = chars.filter((_, i) => ids[i] === 0);
    assert.deepEqual(missing, [], `${name} is missing glyphs`);
  }
});
