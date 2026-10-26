/**
 * SkSL sources. Kept as plain strings (no Skia import) so tests can compile
 * them with CanvasKit in Node.
 *
 * Conventions: float literals everywhere, coordinates in sheet pixels,
 * one global light direction (uLight), seeded per letter (uSeed).
 */

const NOISE = /* sksl */ `
float hash(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float a = hash(i);
  float b = hash(i + float2(1.0, 0.0));
  float c = hash(i + float2(0.0, 1.0));
  float d = hash(i + float2(1.0, 1.0));
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(float2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * vnoise(p);
    p = p * 2.03 + float2(17.1, 3.7);
    amp *= 0.5;
  }
  return v;
}
`;

/**
 * Paper: base colour × large mottling × fine grain − fibres, printed grid and
 * margin with uneven ink strike, crease shading at the thirds (never fully gone),
 * a whisper of edge darkening.
 */
export const PAPER_SKSL = /* sksl */ `
uniform float2 uSize;
uniform float uSeed;
uniform float3 uBase;
uniform float uCell;
uniform float uMarginX;
uniform float3 uGridColor;
uniform float3 uMarginColor;
uniform float uCrease;
uniform float2 uLight;
uniform float2 uCreaseOffset;
${NOISE}
half4 main(float2 xy) {
  float2 p = xy + float2(uSeed * 0.731, uSeed * 0.317);
  float mottle = fbm(p * 0.0045);
  float grain = vnoise(p * 0.85);
  float fibre = fbm(float2(p.x * 0.09 + p.y * 0.02, p.y * 0.55));

  float3 col = uBase;
  col *= 0.965 + 0.06 * mottle;
  col *= 0.982 + 0.036 * grain;
  col -= 0.03 * smoothstep(0.6, 0.82, fibre);

  if (uCell > 0.0) {
    float2 g = abs(fract(xy / uCell + 0.5) - 0.5) * uCell;
    float lineMask = 1.0 - smoothstep(0.2, 0.9, min(g.x, g.y));
    float strike = 0.7 + 0.3 * vnoise(xy * 0.07 + uSeed);
    col = mix(col, uGridColor * col, lineMask * 0.42 * strike);
  }
  if (uMarginX > 0.0) {
    float d = abs(xy.x - uMarginX);
    float m = 1.0 - smoothstep(0.55, 1.5, d);
    float strike = 0.75 + 0.25 * vnoise(xy * 0.05 + uSeed * 2.0);
    col = mix(col, uMarginColor * col, m * 0.85 * strike);
  }

  // Tri-fold creases: a valley line plus a lit and a shaded side.
  for (int k = 1; k <= 2; k++) {
    float off = (k == 1) ? uCreaseOffset.x : uCreaseOffset.y;
    float y = uSize.y * float(k) / 3.0 + off;
    float d = xy.y - y;
    float valley = exp(-d * d / 3.0);
    float slope = d * exp(-d * d / 90.0) / 9.5;
    float facing = (k == 1) ? -1.0 : 1.0;
    col *= 1.0 + uCrease * (0.09 * slope * facing * -uLight.y - 0.07 * valley);
  }

  float2 uv = xy / uSize;
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  col *= 0.965 + 0.035 * smoothstep(0.0, 0.05, edge);

  return half4(half3(clamp(col, 0.0, 1.0)), 1.0);
}
`;

/** Ink: uneven density (nib starving on paper tooth). Used as the text paint shader. */
export const INK_SKSL = /* sksl */ `
uniform float3 uInk;
uniform float uSeed;
${NOISE}
half4 main(float2 xy) {
  float tooth = vnoise(xy * 1.6 + uSeed);
  float pool = fbm(xy * 0.05 + uSeed * 0.1);
  float a = 0.8 + 0.12 * tooth + 0.08 * pool;
  float3 c = uInk * (0.92 + 0.16 * pool);
  return half4(half3(c) * a, a);
}
`;
