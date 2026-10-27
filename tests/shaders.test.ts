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

const grid = { kind: 'grid' as const, ruling: 'grid' as const, base: [0.965, 0.955, 0.93] as const, cell: 14, marginX: 0, gridColor: [0.55, 0.65, 0.78] as const, marginColor: [0.86, 0.4, 0.46] as const, bleed: 0.35, showThrough: 0.12, ghostBlur: 0.9 };
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

// Seyès (§5.2): heavy pitch width/15, margin two pitches from the left of every face.
const seyes = {
  kind: 'seyes' as const,
  ruling: 'seyes' as const,
  marginSide: 'left' as const,
  base: [0.962, 0.955, 0.94] as const,
  cell: sheet.width / 15,
  marginX: 0,
  gridColor: [0.62, 0.72, 0.86] as const,
  heavyColor: [0.6, 0.5, 0.76] as const,
  marginColor: [0.85, 0.32, 0.36] as const,
  bleed: 0.3,
  showThrough: 0.07,
  ghostBlur: 1,
  cockle: 0,
};
const airmail = { kind: 'airmail' as const, ruling: 'none' as const, base: [0.948, 0.944, 0.925] as const, cell: 0, marginX: 0, gridColor: [0, 0, 0] as const, marginColor: [0, 0, 0] as const, bleed: 0.22, showThrough: 0.2, ghostBlur: 0.6, cockle: 1 };
const cotton = { ...airmail, kind: 'cotton' as const, base: [0.955, 0.93, 0.88] as const, cockle: 0 };

/** Renders only a region of the sheet (CPU raster is slow): RGBA bytes, row-major, w × h. */
async function renderRegion(uniforms: number[], x: number, y: number, w: number, h: number) {
  const CK = await loadCanvasKit();
  const effect = CK.RuntimeEffect.Make(PAPER_SKSL)!;
  const surface = CK.MakeSurface(w, h)!;
  const paint = new CK.Paint();
  paint.setShader(effect.makeShader(uniforms));
  const canvas = surface.getCanvas();
  canvas.translate(-x, -y);
  canvas.drawRect(CK.XYWHRect(x, y, w, h), paint);
  const img = surface.makeImageSnapshot();
  return img.readPixels(0, 0, { width: w, height: h, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB }) as Uint8Array;
}
const columnRedness = (px: Uint8Array) => {
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += px[i] - px[i + 2];
  return sum;
};
const mean = (px: Uint8Array, f: (r: number, g: number, b: number) => number) => {
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += f(px[i], px[i + 1], px[i + 2]);
  return sum / (px.length / 4);
};
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('every paper feeds exactly the uniforms PAPER_SKSL declares, the side last', async () => {
  const uniformCount = (await loadCanvasKit()).RuntimeEffect.Make(PAPER_SKSL)!.getUniformFloatCount();
  for (const p of [seyes, airmail, cotton]) {
    assert.equal(paperUniforms(p, sheet, 3, 1).length, uniformCount, p.kind);
    assert.deepEqual([paperUniforms(p, sheet, 3, 1).at(-1), paperUniforms(p, sheet, 3, 1, 'tri', 'verso').at(-1)], [0, 1], p.kind);
  }
});

test('a Seyès face has its margin on the left on both sides, and nothing red on the right', async () => {
  const margin = seyes.cell * 2;
  for (const side of ['recto', 'verso'] as const) {
    const u = paperUniforms(seyes, sheet, 3, 0, 'tri', side);
    const left = columnRedness(await renderRegion(u, Math.round(margin), 0, 1, sheet.height));
    const right = columnRedness(await renderRegion(u, Math.round(sheet.width - margin), 0, 1, sheet.height));
    assert.ok(left > right + 8000, `${side}: margin on the left (${left} vs ${right})`);
    assert.ok(right < 2000, `${side}: no margin on the right (${right})`);
  }
});

test('Seyès heavy lines are darker and more violet than the fine lines', async () => {
  const u = paperUniforms(seyes, sheet, 3, 0);
  // A row on the 10th heavy line and one on the fine line a quarter pitch below, clear of the margin.
  const x = Math.round(seyes.cell * 2.5);
  const w = Math.round(seyes.cell * 0.9);
  const heavyY = Math.round(seyes.cell * 10);
  const fineY = Math.round(seyes.cell * 10.25);
  const blankY = Math.round(seyes.cell * 10.125);
  const heavy = await renderRegion(u, x, heavyY, w, 1);
  const fine = await renderRegion(u, x, fineY, w, 1);
  const blank = await renderRegion(u, x, blankY, w, 1);
  assert.ok(mean(heavy, luma) < mean(fine, luma) - 3, 'heavy darker than fine');
  assert.ok(mean(fine, luma) < mean(blank, luma) - 1, 'fine darker than the paper between lines');
  const violet = (r: number, g: number) => r - g;
  assert.ok(mean(heavy, violet) > mean(fine, violet) + 4, 'heavy more violet (red over green) than fine');
  assert.ok(mean(fine, (r, g, b) => b - r) > mean(blank, (r, g, b) => b - r), 'fine lines are blue');
});

test('airmail: plain paper without cockle, a faint relief (≤ 3 %) with it', async () => {
  const [x, y, w, h] = [140, 200, 128, 128];
  const flat = await renderRegion(paperUniforms({ ...airmail, cockle: 0 }, sheet, 3, 0), x, y, w, h);
  const plain = await renderRegion(paperUniforms(cotton, sheet, 3, 0), x, y, w, h);
  const cockled = await renderRegion(paperUniforms(airmail, sheet, 3, 0), x, y, w, h);
  const std = (px: Uint8Array) => {
    const m = mean(px, luma);
    return Math.sqrt(mean(px, (r, g, b) => (luma(r, g, b) - m) ** 2));
  };
  // Without cockle, airmail is cotton's structure on a cooler base: the same noise, no rules.
  assert.ok(Math.abs(std(flat) - std(plain)) < 0.25 * std(plain) + 0.3, `structure ${std(flat)} vs ${std(plain)}`);
  assert.ok(mean(flat, (r, g, b) => Math.abs(b - r)) < 12, 'no printed rules');
  let max = 0;
  let changed = 0;
  for (let i = 0; i < flat.length; i += 4)
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(cockled[i + c] - flat[i + c]);
      max = Math.max(max, (d - 1) / flat[i + c]); // one level of 8-bit rounding
      if (d > 0) changed++;
    }
  assert.ok(max <= 0.03, `cockle changes a pixel by at most 3 % (${(max * 100).toFixed(2)} %)`);
  assert.ok(changed > flat.length / 8, 'cockle is visible');
});
