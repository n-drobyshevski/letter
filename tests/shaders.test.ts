import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { INK_SKSL, LINER_SKSL, PAPER_SKSL, POWDER_SKSL, STAMP_INK_SKSL, WAX_SKSL } from '../src/letter/shaders';

const require = createRequire(import.meta.url);

// The same CanvasKit build that react-native-skia uses on web.
async function loadCanvasKit() {
  const init = require('canvaskit-wasm/bin/full/canvaskit.js');
  return init({ locateFile: (f: string) => require.resolve(`canvaskit-wasm/bin/full/${f}`) });
}

test('stationery SkSL compiles', async () => {
  const CK = await loadCanvasKit();
  for (const [name, src] of [['paper', PAPER_SKSL], ['ink', INK_SKSL], ['liner', LINER_SKSL], ['wax', WAX_SKSL], ['stamp ink', STAMP_INK_SKSL], ['powder coat', POWDER_SKSL]] as const) {
    const errors: string[] = [];
    const effect = CK.RuntimeEffect.Make(src, (e: string) => errors.push(e));
    assert.ok(effect, `${name} shader failed to compile:\n${errors.join('\n')}`);
  }
});
