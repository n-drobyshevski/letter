import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { LEATHER_SKSL, PEN_SKSL, WOOD_SKSL } from '../src/letter/desk/deskShaders';
import { LIGHT_DIR, linerUniforms } from '../src/letter/paperLayout';
import { LINER_SKSL } from '../src/letter/shaders';
import { DESK_PRESETS, leatherUniforms, woodUniforms, type Lamp } from '../src/letter/desk/deskUniforms';

const require = createRequire(import.meta.url);

// The same CanvasKit build that react-native-skia uses on web.
let ck: Promise<any> | null = null;
function loadCanvasKit() {
  const init = require('canvaskit-wasm/bin/full/canvaskit.js');
  ck ??= init({ locateFile: (f: string) => require.resolve(`canvaskit-wasm/bin/full/${f}`) });
  return ck!;
}

/** Renders `src` with `uniforms` over a w × h canvas (the shader's own coordinates) and returns RGBA bytes. */
async function render(src: string, uniforms: number[], w: number, h: number) {
  const CK = await loadCanvasKit();
  const effect = CK.RuntimeEffect.Make(src)!;
  const surface = CK.MakeSurface(w, h)!;
  const paint = new CK.Paint();
  paint.setShader(effect.makeShader(uniforms));
  surface.getCanvas().drawRect(CK.XYWHRect(0, 0, w, h), paint);
  const img = surface.makeImageSnapshot();
  return img.readPixels(0, 0, {
    width: w,
    height: h,
    colorType: CK.ColorType.RGBA_8888,
    alphaType: CK.AlphaType.Unpremul,
    colorSpace: CK.ColorSpace.SRGB,
  }) as Uint8Array;
}

/** CIE L* of an sRGB pixel (0..255 channels). */
function lstar(r: number, g: number, b: number) {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}
const lstars = (px: Uint8Array) => {
  const out: number[] = [];
  for (let i = 0; i < px.length; i += 4) out.push(lstar(px[i], px[i + 1], px[i + 2]));
  return out;
};
const meanOf = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
/** Mean L* of a w × h region's quadrant (0 top-left … 3 bottom-right). */
function quadrant(px: Uint8Array, w: number, h: number, qx: 0 | 1, qy: 0 | 1) {
  const v: number[] = [];
  for (let y = qy * (h / 2); y < (qy + 1) * (h / 2); y++)
    for (let x = qx * (w / 2); x < (qx + 1) * (w / 2); x++) {
      const i = (y * w + x) * 4;
      v.push(lstar(px[i], px[i + 1], px[i + 2]));
    }
  return meanOf(v);
}

/** A lamp so high its light is even over the patch: only the grain varies. */
const FLAT: Lamp = { x: 128, y: 128, h: 1e5 };

test('desk SkSL compiles', async () => {
  const CK = await loadCanvasKit();
  for (const [name, src] of [
    ['wood', WOOD_SKSL],
    ['leather', LEATHER_SKSL],
    ['pen', PEN_SKSL],
  ] as const) {
    const errors: string[] = [];
    const effect = CK.RuntimeEffect.Make(src, (e: string) => errors.push(e));
    assert.ok(effect, `${name} shader failed to compile:\n${errors.join('\n')}`);
  }
});

test('the uniform builders feed exactly the uniforms the shaders declare', async () => {
  const CK = await loadCanvasKit();
  const wood = CK.RuntimeEffect.Make(WOOD_SKSL)!;
  const leather = CK.RuntimeEffect.Make(LEATHER_SKSL)!;
  for (const preset of ['fr', 'ru'] as const) {
    assert.equal(woodUniforms(preset, { width: 10, height: 10 }, 1, 1, false, FLAT).length, wood.getUniformFloatCount());
    assert.equal(
      woodUniforms(DESK_PRESETS[preset].interior, { width: 10, height: 10 }, 1, 1, true, FLAT, 5).length,
      wood.getUniformFloatCount(),
    );
    const P = DESK_PRESETS[preset];
    assert.equal(
      leatherUniforms(P.leather, { width: 10, height: 10 }, 1, 1, { lamp: FLAT, fillets: [3, 5], gilt: P.gilt }).length,
      leather.getUniformFloatCount(),
    );
    assert.equal(
      leatherUniforms(P.felt, { width: 10, height: 10 }, 1, 1, { lamp: FLAT, felt: true }).length,
      leather.getUniformFloatCount(),
    );
  }
});

for (const preset of ['fr', 'ru'] as const) {
  test(`${preset} wood: grain within 8 L* at the drawers' scale, never pure black or white`, async () => {
    // A 256² patch at far scale (0.68 pt/mm: 376 mm of desk), seams included.
    const px = await render(WOOD_SKSL, woodUniforms(preset, { width: 256, height: 256 }, 11, 0.68, false, FLAT), 256, 256);
    const l = lstars(px);
    const m = meanOf(l);
    const sd = Math.sqrt(meanOf(l.map((v) => (v - m) ** 2)));
    assert.ok(sd <= 8, `L* standard deviation ${sd.toFixed(2)}`);
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
      assert.ok(!(r === 0 && g === 0 && b === 0) && !(r === 255 && g === 255 && b === 255), 'pure black or white pixel');
    }
  });

  test(`${preset} wood: lit from the top-left, and a vertical face is darker than the top`, async () => {
    const lamp: Lamp = { x: 0, y: 0, h: 140 };
    const top = await render(WOOD_SKSL, woodUniforms(preset, { width: 160, height: 160 }, 5, 2.4, false, lamp), 160, 160);
    assert.ok(quadrant(top, 160, 160, 0, 0) > quadrant(top, 160, 160, 1, 1) + 2, 'the lamp side is brighter');
    const face = await render(WOOD_SKSL, woodUniforms(preset, { width: 160, height: 160 }, 5, 2.4, true, lamp), 160, 160);
    assert.ok(meanOf(lstars(face)) < meanOf(lstars(top)) - 2, 'uFace = 1 is darker');
  });

  test(`${preset} leather: the gilt fillet is more golden than the field`, async () => {
    const P = DESK_PRESETS[preset];
    const w = 200;
    const px = await render(
      LEATHER_SKSL,
      leatherUniforms(P.leather, { width: w, height: w }, 3, 2.4, { lamp: FLAT, fillets: [20, 0], gilt: P.gilt }),
      w,
      w,
    );
    // Gold: red and green well over blue.
    const gold = (x: number) => {
      let sum = 0;
      for (let y = 40; y < 160; y++) {
        const i = (y * w + x) * 4;
        sum += (px[i] + px[i + 1]) / 2 - px[i + 2];
      }
      return sum / 120;
    };
    assert.ok(gold(20) > gold(100) + 8, `fillet ${gold(20).toFixed(1)} vs field ${gold(100).toFixed(1)}`);
  });
}

// ---------------------------------------------------------------- the review's fixes

const rowMeans = (px: Uint8Array, w: number, h: number) =>
  Array.from({ length: h }, (_, y) => {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      sum += lstar(px[i], px[i + 1], px[i + 2]);
    }
    return sum / w;
  });

for (const preset of ['fr', 'ru'] as const) {
  test(`${preset} wood: no seam across the top of a canvas (the header), and a seam is a shallow line`, async () => {
    // The desk top at a phone's near scale: 400 pt down from the content's top.
    // Seeds whose first seam used to fall in the top 130 pt (2, 5) or ran 16 L* deep (4).
    for (const seed of [2, 4, 5]) {
      const w = 64;
      const h = 400;
      const px = await render(WOOD_SKSL, woodUniforms(preset, { width: w, height: h }, seed, 2.39, false, FLAT), w, h);
      const rows = rowMeans(px, w, h);
      // A seam is a dip of a few rows against the rows around it.
      const dips = rows.map((v, y) => {
        const around = [...rows.slice(Math.max(0, y - 8), Math.max(0, y - 3)), ...rows.slice(y + 4, y + 9)];
        return around.length ? meanOf(around) - v : 0;
      });
      const header = Math.max(...dips.slice(0, 130));
      assert.ok(header < 4.5, `seed ${seed}: a dip of ${header.toFixed(1)} L* in the top 130 pt`);
      assert.ok(Math.max(...dips) <= 8, `seed ${seed}: a seam ${Math.max(...dips).toFixed(1)} L* deep`);
    }
  });
}

test('envelope liner: its fine lines fade to their mean tone where they would alias, never shifting the tone', async () => {
  const liner = { base: [0.42, 0.12, 0.16] as const, pattern: [0.62, 0.48, 0.3] as const, scale: 9 };
  const w = 90;
  const stats = async (px: number) => {
    const p = await render(LINER_SKSL, linerUniforms(liner, 3, 1, px), w, w);
    const l = lstars(p);
    const m = meanOf(l);
    return { mean: m, sd: Math.sqrt(meanOf(l.map((v) => (v - m) ** 2))) };
  };
  const near = await stats(2); // a full-size envelope: 9 × 2 = 18 px a period
  const far = await stats(0.2); // a drawer's stock: under 2 px a period
  assert.ok(near.sd > 4, `the pattern shows up close (sd ${near.sd.toFixed(2)})`);
  assert.ok(far.sd < near.sd / 3, `and fades far (sd ${far.sd.toFixed(2)})`);
  assert.ok(Math.abs(far.mean - near.mean) < 2.5, `same mean tone: ${far.mean.toFixed(1)} vs ${near.mean.toFixed(1)}`);
});

test('pens: black resin is never shaded to black, and clear glass lets the felt through in the middle', async () => {
  const len = 60;
  const r = 10;
  // uLen, uRad, uColor, uColor2, uPattern, uPatternScale, uGloss, uSpec, uMetal, uLight, uSeed, uAlpha.
  const uniforms = (color: number[], alpha: number, pattern = 0) => [
    len,
    r,
    r,
    ...color,
    ...color,
    pattern,
    14,
    50,
    0.4,
    0,
    LIGHT_DIR.x,
    LIGHT_DIR.y,
    1,
    alpha,
  ];
  const CK = await loadCanvasKit();
  const draw = (u: number[]) => {
    const effect = CK.RuntimeEffect.Make(PEN_SKSL)!;
    assert.equal(u.length, effect.getUniformFloatCount());
    const surface = CK.MakeSurface(len, 2 * r)!;
    const paint = new CK.Paint();
    paint.setShader(effect.makeShader(u));
    const c = surface.getCanvas();
    c.translate(0, r);
    c.drawRect(CK.XYWHRect(0, -r, len, 2 * r), paint);
    return surface.makeImageSnapshot().readPixels(0, 0, {
      width: len,
      height: 2 * r,
      colorType: CK.ColorType.RGBA_8888,
      alphaType: CK.AlphaType.Unpremul,
      colorSpace: CK.ColorSpace.SRGB,
    }) as Uint8Array;
  };
  const ebonite = draw(uniforms([0.088, 0.075, 0.068], 1));
  for (let y = 2; y < 2 * r - 2; y++) {
    const i = (y * len + 30) * 4;
    assert.ok(Math.max(ebonite[i], ebonite[i + 1], ebonite[i + 2]) > 8, `row ${y}: ${ebonite.slice(i, i + 3).join(',')}`);
  }
  const glass = draw(uniforms([0.86, 0.9, 0.89], 0.14, 3));
  const mid = (r * len + 30) * 4 + 3;
  const edge = ((2 * r - 2) * len + 30) * 4 + 3;
  assert.ok(glass[mid] < 140, `glass is clear in the middle (alpha ${glass[mid]})`);
  assert.ok(glass[edge] > glass[mid], 'and thicker toward its silhouette');
});
