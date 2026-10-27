import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { paperUniforms } from '../src/letter/paperLayout';
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

const grid = { kind: 'grid' as const, base: [0.965, 0.955, 0.93] as const, cell: 14, marginX: 0, gridColor: [0.55, 0.65, 0.78] as const, marginColor: [0.86, 0.4, 0.46] as const, bleed: 0.35, showThrough: 0.12, ghostBlur: 0.9 };
const sheet = { width: 420, height: 594 };

/** Renders the paper shader with these uniforms and returns RGBA bytes. */
async function renderPaper(uniforms: number[]) {
  const CK = await loadCanvasKit();
  const effect = CK.RuntimeEffect.Make(PAPER_SKSL)!;
  const surface = CK.MakeSurface(sheet.width, sheet.height)!;
  const paint = new CK.Paint();
  paint.setShader(effect.makeShader(uniforms));
  surface.getCanvas().drawRect(CK.XYWHRect(0, 0, sheet.width, sheet.height), paint);
  const img = surface.makeImageSnapshot();
  const px = img.readPixels(0, 0, { width: sheet.width, height: sheet.height, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB })!;
  return { px: px as Uint8Array, uniformCount: effect.getUniformFloatCount() };
}
// Redness of a pixel column near x (the margin rule is pink): R minus B, summed down the sheet.
const redness = (px: Uint8Array, x: number) => {
  let sum = 0;
  for (let y = 40; y < sheet.height - 40; y += 7) {
    const i = (y * sheet.width + Math.round(x)) * 4;
    sum += px[i] - px[i + 2];
  }
  return sum;
};

test('paperUniforms feeds exactly the uniforms PAPER_SKSL declares', async () => {
  const { uniformCount } = await renderPaper(paperUniforms(grid, sheet, 3, 1));
  assert.equal(paperUniforms(grid, sheet, 3, 1).length, uniformCount);
});

test('a notebook verso is the recto mirrored: margin on the left, the same pulp', async () => {
  const recto = (await renderPaper(paperUniforms(grid, sheet, 3, 0))).px;
  const verso = (await renderPaper(paperUniforms(grid, sheet, 3, 0, 'tri', 'verso'))).px;
  const margin = grid.cell * 2.6;
  assert.ok(redness(recto, sheet.width - margin) > redness(recto, margin) + 200, 'recto: margin on the right');
  assert.ok(redness(verso, margin) > redness(verso, sheet.width - margin) + 200, 'verso: margin on the left');
  // Same fibres, seen from behind: pixel (x, y) of the verso is pixel (W - 1 - x, y) of the recto, near enough.
  let diff = 0;
  for (let y = 0; y < sheet.height; y += 13)
    for (let x = 0; x < sheet.width; x += 11) {
      const v = (y * sheet.width + x) * 4;
      const r = (y * sheet.width + (sheet.width - 1 - x)) * 4;
      diff += Math.abs(verso[v] - recto[r]);
    }
  assert.ok(diff / ((sheet.height / 13) * (sheet.width / 11)) < 4, `mean difference ${diff}`);
});
