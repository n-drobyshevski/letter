import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { coverSD, outline, pressTouches, sealBounds, shaderSeed, type SealPx } from '../src/letter/seal';
import { SEAL_BOX, SEAL_DIES } from '../src/letter/sealDies';
import { WAX_SKSL } from '../src/letter/shaders';

const require = createRequire(import.meta.url);

// The same CanvasKit build that react-native-skia uses on web.
async function loadCanvasKit() {
  const init = require('canvaskit-wasm/bin/full/canvaskit.js');
  return init({ locateFile: (f: string) => require.resolve(`canvaskit-wasm/bin/full/${f}`) });
}

/** {name: number | number[]} onto the effect's uniform layout; throws on a missing or mis-sized uniform. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function floats(effect: any, u: Record<string, number | number[]>) {
  const out = new Float32Array(effect.getUniformFloatCount());
  for (let i = 0; i < effect.getUniformCount(); i++) {
    const name = effect.getUniformName(i);
    const info = effect.getUniform(i);
    const v = u[name];
    assert.ok(v !== undefined, `missing uniform ${name}`);
    const arr = typeof v === 'number' ? [v] : v;
    assert.equal(arr.length, info.columns * info.rows, `uniform ${name} size`);
    out.set(arr, info.slot);
  }
  return out;
}

const TILE = 120; // pt
const SCALE = 2; // device px per pt, like a phone (the shader works in pt)
const C = TILE / 2;
const maxR = 29; // DL at 340 pt wide
const stampR = maxR * 0.72;
const base: SealPx = {
  x: C,
  y: C,
  r: maxR,
  stretch: [0, 0],
  drops: [],
  stamp: { x: C, y: C, r: stampR, angle: 0, depth: 1 },
  seed: 11,
};

const CASES: [string, SealPx][] = [
  ['centred', base],
  [
    'stretched, drops, die off-centre and late',
    {
      ...base,
      stretch: [0.18, 0.18],
      drops: [
        [C + 34, C + 30, 3.2],
        [C - 31, C - 18, 1.8],
      ],
      stamp: { x: C + 4, y: C + 4, r: stampR, angle: -0.2, depth: 0.5 },
    },
  ],
  ['die overhanging the edge', { ...base, stamp: { x: C + 22, y: C + 8, r: stampR, angle: 0.9, depth: 1 } }],
  ['small puddle, die cut off', { ...base, r: maxR * 0.6, seed: 40 }],
];

test('WAX_SKSL v2 renders exactly the shape seal.ts computes (coverSD is its twin)', async () => {
  const CK = await loadCanvasKit();
  const errors: string[] = [];
  const effect = CK.RuntimeEffect.Make(WAX_SKSL, (e: string) => errors.push(e));
  assert.ok(effect, errors.join('\n'));

  // A real die texture (the heart): the outline must not depend on the engraving.
  const size = Math.ceil(stampR * 2 * SCALE);
  const dieSurf = CK.MakeSurface(size, size);
  const dc = dieSurf.getCanvas();
  dc.clear(CK.TRANSPARENT);
  const white = new CK.Paint();
  white.setColor(CK.WHITE);
  white.setMaskFilter(CK.MaskFilter.MakeBlur(CK.BlurStyle.Normal, size * 0.008, true));
  dc.scale(size / SEAL_BOX, size / SEAL_BOX);
  for (const p of SEAL_DIES.heart.paths) dc.drawPath(CK.Path.MakeFromSVGString(p.d), white);
  const dieImg = dieSurf.makeImageSnapshot();

  for (const [name, s] of CASES) {
    assert.ok(pressTouches(s), `${name}: the die touches`);
    const st = s.stamp!;
    const child = dieImg.makeShaderOptions(CK.TileMode.Decal, CK.TileMode.Decal, CK.FilterMode.Linear, CK.MipmapMode.None);
    const shader = effect.makeShaderWithChildren(
      floats(effect, {
        uDieSize: size,
        uCenter: [s.x, s.y],
        uR: s.r,
        uStretch: s.stretch,
        uDropA: s.drops[0] ?? [0, 0, 0],
        uDropB: s.drops[1] ?? [0, 0, 0],
        uStamp: [st.x, st.y],
        uStampR: st.r,
        uAngle: st.angle,
        uImprint: 1,
        uDepth: st.depth,
        uMolten: 0.15,
        uSeed: shaderSeed(s.seed),
        uColor: [0.48, 0.07, 0.1],
        uLight: [-0.45, -0.75],
        uFlex: 0,
      }),
      [child],
    );
    const surf = CK.MakeSurface(TILE * SCALE, TILE * SCALE);
    const c = surf.getCanvas();
    c.clear(CK.TRANSPARENT);
    c.scale(SCALE, SCALE);
    const paint = new CK.Paint();
    paint.setShader(shader);
    const b = sealBounds(s);
    c.drawRect(CK.XYWHRect(b.x, b.y, b.width, b.height), paint);
    const px = surf.makeImageSnapshot().readPixels(0, 0, {
      width: TILE * SCALE,
      height: TILE * SCALE,
      colorType: CK.ColorType.RGBA_8888,
      alphaType: CK.AlphaType.Unpremul,
      colorSpace: CK.ColorSpace.SRGB,
    });
    const alphaAt = (x: number, y: number) => px[(Math.floor(y * SCALE) * TILE * SCALE + Math.floor(x * SCALE)) * 4 + 3] / 255;

    let checked = 0;
    let bad = 0;
    for (let y = 0.25; y < TILE; y += 0.5) {
      for (let x = 0.25; x < TILE; x += 0.5) {
        const sd = coverSD(s, x, y);
        if (Math.abs(sd) < 1.2) continue; // the antialiased rim; the shadow is < 0.6 alpha
        checked++;
        if (sd > 0 !== alphaAt(x, y) > 0.6) bad++;
      }
    }
    assert.ok(checked > 40000, `${name}: sampled ${checked}`);
    assert.equal(bad, 0, `${name}: ${bad} of ${checked} samples disagree with coverSD`);

    // Nothing the shader draws falls outside the Rect: the edge of the bounds is clear.
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      for (const [x, y] of [
        [b.minX + t * b.width, b.minY + 0.5],
        [b.minX + t * b.width, b.maxY - 0.5],
        [b.minX + 0.5, b.minY + t * b.height],
        [b.maxX - 0.5, b.minY + t * b.height],
      ]) {
        if (x < 0 || y < 0 || x >= TILE || y >= TILE) continue;
        assert.ok(alphaAt(x, y) < 0.02, `${name}: bounds clip the seal or its shadow at ${x.toFixed(1)}, ${y.toFixed(1)}`);
      }
    }

    // The outline polygon (the flexible-wax film) sits on the rendered edge.
    const ol = outline(s);
    for (let i = 0; i < ol.length; i += 2) {
      const dx = ol[i] - (st.x + s.x) / 2;
      const dy = ol[i + 1] - (st.y + s.y) / 2;
      const d = Math.hypot(dx, dy);
      const [ix, iy] = [ol[i] - (dx / d) * 1.5, ol[i + 1] - (dy / d) * 1.5];
      if (ix >= 0 && iy >= 0 && ix < TILE && iy < TILE && coverSD(s, ix, iy) > 1.2) {
        assert.ok(alphaAt(ix, iy) > 0.6, `${name}: outline point ${i / 2} not on the wax`);
      }
    }
  }
});
