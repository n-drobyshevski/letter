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
uniform float uFold; // 0 tri-fold, 1 half, 2 quarter (half + a vertical crease)
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

  // Creases: a valley line plus a lit and a shaded side.
  if (uFold < 0.5) {
    // Tri-fold: near the thirds.
    for (int k = 1; k <= 2; k++) {
      float off = (k == 1) ? uCreaseOffset.x : uCreaseOffset.y;
      float y = uSize.y * float(k) / 3.0 + off;
      float d = xy.y - y;
      float valley = exp(-d * d / 3.0);
      float slope = d * exp(-d * d / 90.0) / 9.5;
      float facing = (k == 1) ? -1.0 : 1.0;
      col *= 1.0 + uCrease * (0.09 * slope * facing * -uLight.y - 0.07 * valley);
    }
  } else {
    // Half fold: across the middle; the quarter fold adds one down the middle.
    float d = xy.y - (uSize.y * 0.5 + uCreaseOffset.x);
    float slope = d * exp(-d * d / 90.0) / 9.5;
    col *= 1.0 + uCrease * (0.09 * slope * uLight.y - 0.07 * exp(-d * d / 3.0));
    if (uFold > 1.5) {
      float dx = xy.x - (uSize.x * 0.5 + uCreaseOffset.y);
      float sx = dx * exp(-dx * dx / 90.0) / 9.5;
      col *= 1.0 + uCrease * (0.09 * sx * uLight.x - 0.06 * exp(-dx * dx / 3.0));
    }
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

/**
 * Envelope liner: the inside of the envelope, printed with a fine "security"
 * diamond pattern (as on Russian and French post-office envelopes), in shade.
 */
export const LINER_SKSL = /* sksl */ `
uniform float uSeed;
uniform float3 uBase;
uniform float3 uPattern;
uniform float uScale;
uniform float uShade;
${NOISE}
half4 main(float2 xy) {
  float2 p = xy + uSeed;
  float a = abs(fract((xy.x + xy.y) / uScale) - 0.5);
  float b = abs(fract((xy.x - xy.y) / uScale) - 0.5);
  float lines = 1.0 - smoothstep(0.035, 0.11, min(a, b));
  float strike = 0.75 + 0.25 * vnoise(xy * 0.06 + uSeed);
  float3 col = uBase * (0.975 + 0.05 * fbm(p * 0.006)) * (0.985 + 0.03 * vnoise(p * 0.9));
  col = mix(col, uPattern, lines * 0.85 * strike);
  return half4(half3(col * uShade), 1.0);
}
`;

/**
 * Sealing wax, poured and pressed anywhere (envelope-local pt).
 *
 * Puddle: centre uCenter, base radius uR, a seeded wavy outline, optionally drawn
 * out along uStretch (direction × amount, the way the stick moved while pouring),
 * plus up to two satellite drops (uDropA/B: x, y, r; r = 0 → none).
 * Die: centre uStamp (independent of the puddle), radius uStampR, rotation uAngle.
 * `die` is the imprint's height map (alpha; 1 = raised in the wax), a square image of
 * uDieSize px that covers the die disc, sampled in image space (identity local matrix).
 * uImprint (0..1) is how far the die has travelled down; uDepth (0..1) how warm the
 * wax was when it arrived: deep, crisp and squeezed out when warm; shallow, soft,
 * only the crown touched, and crazed when late. A die that misses the wax leaves nothing.
 */
export const WAX_SKSL = /* sksl */ `
uniform shader die;
uniform float uDieSize;
uniform float2 uCenter;
uniform float uR;
uniform float2 uStretch;
uniform float3 uDropA;
uniform float3 uDropB;
uniform float2 uStamp;
uniform float uStampR;
uniform float uAngle;
uniform float uImprint;
uniform float uDepth;
uniform float uMolten;
uniform float uSeed;
uniform float3 uColor;
uniform float2 uLight;
uniform float uFlex;
${NOISE}
float edgeR(float a) {
  return uR * (1.0 + 0.055 * sin(3.0 * a + uSeed) + 0.035 * sin(5.0 * a + uSeed * 1.7)
                   + 0.02 * sin(9.0 * a + uSeed * 0.3) + 0.012 * sin(17.0 * a + uSeed * 2.1));
}
// Undo the pour's elongation: the leading side (where the stick went) is drawn out more.
float2 unstretch(float2 d) {
  float e = length(uStretch);
  if (e < 0.001) {
    return d;
  }
  float2 u = uStretch / e;
  float a = dot(d, u);
  float b = dot(d, float2(-u.y, u.x));
  float lead = smoothstep(-uR * 0.6, uR * 0.6, a);
  return float2(a / (1.0 + e * (0.55 + 0.9 * lead)), b * (1.0 + 0.45 * e));
}
float smaxk(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return max(a, b) + h * h * k * 0.25;
}
// Signed distance to the puddle's edge, in pt, positive inside (approximate off the edge).
float puddleSD(float2 p) {
  float2 d = unstretch(p - uCenter);
  float sd = edgeR(atan(d.y, d.x + 0.0001)) - length(d);
  if (uDropA.z > 0.0) {
    sd = smaxk(sd, uDropA.z - length(p - uDropA.xy), uDropA.z * 0.9);
  }
  if (uDropB.z > 0.0) {
    sd = smaxk(sd, uDropB.z - length(p - uDropB.xy), uDropB.z * 0.9);
  }
  return sd;
}
// The distance the surface is shaded from: surface tension smooths the outline's fine
// waviness (the 9th and 17th harmonics) within a millimetre or two of the rim, so the
// meniscus is one continuous curve, not a lobe (and a highlight) per scallop. The full
// outline still decides the outermost rim; coverage (puddleSD) is untouched.
float shadeSD(float2 p, float sd) {
  float2 d = unstretch(p - uCenter);
  float a = atan(d.y, d.x + 0.0001);
  float low = uR * (1.0 + 0.055 * sin(3.0 * a + uSeed) + 0.035 * sin(5.0 * a + uSeed * 1.7)) - length(d);
  if (uDropA.z > 0.0) {
    low = smaxk(low, uDropA.z - length(p - uDropA.xy), uDropA.z * 0.9);
  }
  if (uDropB.z > 0.0) {
    low = smaxk(low, uDropB.z - length(p - uDropB.xy), uDropB.z * 0.9);
  }
  return mix(sd, low, smoothstep(0.0, 0.12 * uR, sd));
}
// A gentle crown over the plateau (surface tension again), so the gloss is one broad glint.
float crownAt(float2 p) {
  float r = clamp(length(unstretch(p - uCenter)) / max(uR, 1.0), 0.0, 1.0);
  return 0.06 * (1.0 - r) * (1.0 - r);
}
float dome(float sd, float w) {
  float t = clamp(sd / w, 0.0, 1.0);
  return sqrt(1.0 - (1.0 - t) * (1.0 - t)) * 0.85;
}
// Height of the wax at p (0 = paper, ~0.85 = crown) and, in .y, how much the die touched.
float2 heightAt(float2 p) {
  float sd = shadeSD(p, puddleSD(p));
  float w = max(uR * 0.38, 1.0);
  float squeeze = uImprint * uDepth;
  float spread = uR * 0.1 * squeeze;

  float2 q = p - uStamp;
  float rs = length(q);
  float c = cos(uAngle);
  float s = sin(uAngle);
  float2 uv = float2(c * q.x + s * q.y, -s * q.x + c * q.y) / uStampR;
  float eng = die.eval((uv * 0.5 + 0.5) * uDieSize).a;

  // Outside the die: the puddle, bulged out a little next to the die, and the lip of
  // wax squeezed up around its rim.
  float near = exp(-max(rs - uStampR, 0.0) / (uStampR * 0.3));
  float sdOut = sd + spread * near;
  float hOut = dome(sdOut, w);
  float lipD = (rs - uStampR * 1.06) / (uStampR * 0.08);
  float lip = exp(-lipD * lipD) * 0.24 * squeeze * smoothstep(0.0, 0.2, hOut);
  hOut += lip;

  // Under the die: wax pushed outwards, but no further than the die's rim, so a die
  // hanging over the edge leaves a cut arc. Pressed wax stands up steeply at its edge.
  float sdIn = max(sd, min(sd + spread, uStampR - rs));
  float avail = dome(sdIn, mix(w, 1.6, squeeze));
  // uImprint 0 = the die just resting on the crown; 1 = as deep as this wax allows.
  float face = mix(0.88, mix(0.72, 0.46, uDepth), uImprint) + 0.015 * vnoise(p * 0.22 + uSeed);
  // Warm wax fills the engraving; cold wax only its deepest middle, and not as high.
  float fill = smoothstep(mix(0.5, 0.04, uDepth), 1.0, eng);
  float dieZ = face + mix(0.07, 0.36, uDepth) * fill;
  // Cold wax springs back a little: the crown's curve survives under a late press.
  float hIn = avail - (avail - min(avail, dieZ)) * mix(0.6, 1.0, uDepth);
  float touched = smoothstep(-0.01, 0.03, avail - face);

  float inDie = 1.0 - smoothstep(uStampR - 0.7, uStampR + 0.7, rs);
  // The die flattens the crown where it goes in.
  float crown = crownAt(p) * step(0.0, sd) * (1.0 - inDie * uImprint);
  return float2(mix(hOut, hIn, inDie) + crown, touched * inDie * step(0.001, uImprint));
}
// Where the wax ends after the press (pt, positive = wax): heightAt's outline, without the die image.
float coverAt(float2 p) {
  float sd = puddleSD(p);
  float rs = length(p - uStamp);
  float spread = uR * 0.1 * uImprint * uDepth;
  float inDie = 1.0 - smoothstep(uStampR - 0.7, uStampR + 0.7, rs);
  float near = exp(-max(rs - uStampR, 0.0) / (uStampR * 0.3));
  return mix(sd + spread * near, max(sd, min(sd + spread, uStampR - rs)), inDie);
}
half4 main(float2 xy) {
  float2 q = xy - uStamp;
  float alpha = smoothstep(-0.6, 0.9, coverAt(xy));
  // The seal's own soft shadow, cast away from the desk light (same shape, drops and all).
  // Only needed where the wax doesn't fully cover.
  half4 shadow = half4(0.0);
  if (alpha < 1.0) {
    float sh = smoothstep(-4.0, 3.0, coverAt(xy + uLight * 3.0));
    shadow = half4(0.047, 0.012, 0.006, 0.4) * half(sh * sh);
  }
  if (alpha <= 0.0) {
    return shadow;
  }
  float2 h0 = heightAt(xy);
  float hx = heightAt(xy + float2(1.0, 0.0)).x;
  float hy = heightAt(xy + float2(0.0, 1.0)).x;
  float3 n = normalize(float3(-(hx - h0.x) * 6.0, -(hy - h0.x) * 6.0, 1.0));
  float3 L = normalize(float3(uLight, 1.2));
  float diffuse = max(dot(n, L), 0.0);
  float3 H = normalize(L + float3(0.0, 0.0, 1.0));
  // The die leaves a satin face; the rest keeps whatever gloss the wax had.
  float molten = uMolten * (1.0 - 0.7 * h0.y);
  float gloss = mix(28.0, 70.0, molten);
  float spec = pow(max(dot(n, H), 0.0), gloss) * mix(0.32, 0.6, molten);
  float grain = 0.96 + 0.08 * fbm((xy + uSeed * 13.0) * 0.12);
  float occlusion = 0.72 + 0.28 * clamp(h0.x / 0.85, 0.0, 1.0);
  float thin = 1.0 - smoothstep(0.0, 0.25, h0.x);
  // Pressed too late, the stiff wax splits in short radial cracks out from the die's rim.
  float rs = length(q);
  float sector = atan(q.y, q.x + 0.0001) * 3.8197; // 24 sectors
  float cell = floor(sector);
  float off = (hash(float2(cell + 7.0, uSeed)) - 0.5) * 0.5 + (vnoise(float2(rs * 0.35, cell * 3.1)) - 0.5) * 0.3;
  float halfW = 0.35 / max(rs * 0.2618, 0.5);
  float crackLen = uStampR * mix(0.08, 0.3, hash(float2(cell + 13.0, uSeed)));
  float crack = step(0.5, hash(float2(cell, uSeed)))
    * (1.0 - smoothstep(halfW, halfW * 2.5, abs(fract(sector) - 0.5 - off) / max(1.0 - (rs - uStampR) / crackLen, 0.05)))
    * smoothstep(uStampR * 0.97, uStampR * 1.0, rs) * (1.0 - smoothstep(uStampR + crackLen - 1.5, uStampR + crackLen, rs));
  // Brittle wax only: flexible (glue-gun) wax bends instead of cracking.
  float craze = crack * pow(1.0 - uDepth, 1.5) * uImprint * step(0.06, h0.x) * 0.6 * (1.0 - uFlex);
  float3 col = uColor * grain * (0.42 + 0.72 * diffuse) * occlusion + uColor * thin * 0.35 + spec;
  col *= 1.0 - craze;
  return half4(half3(col) * alpha, alpha) + shadow * half(1.0 - alpha);
}
`;

/**
 * Rubber-stamp ink (postmarks, cancellation waves): patchy coverage, a heavier
 * and a lighter side (stamps are rarely pressed flat), never a solid fill.
 */
export const STAMP_INK_SKSL = /* sksl */ `
uniform float3 uInk;
uniform float uSeed;
uniform float2 uCenter;
uniform float2 uTilt;
uniform float uRadius;
${NOISE}
half4 main(float2 xy) {
  float patch = smoothstep(0.28, 0.62, fbm(xy * 0.09 + uSeed));
  float speck = 0.7 + 0.3 * vnoise(xy * 1.3 + uSeed * 3.0);
  // Pressed unevenly, but no side ever disappears.
  float side = 0.5 + 0.5 * smoothstep(-1.3, 0.7, dot(uTilt, (xy - uCenter) / uRadius));
  float a = clamp((0.35 + 0.65 * patch) * speck * side, 0.0, 1.0) * 0.85;
  return half4(half3(uInk) * a, a);
}
`;

/**
 * Powder-coated sheet steel (postboxes, mailbox banks): orange-peel micro-relief
 * lit by the desk light, a slow dent waviness, lighter at the top, paint chipped
 * to grey primer near edges, grime collecting in patches.
 */
export const POWDER_SKSL = /* sksl */ `
uniform float2 uOrigin;
uniform float2 uSize;
uniform float3 uBase;
uniform float3 uPrimer;
uniform float uSeed;
uniform float2 uLight;
uniform float uWear;
${NOISE}
half4 main(float2 xy) {
  float2 p = xy - uOrigin;
  float h = vnoise(p * 0.45 + uSeed);
  float hx = vnoise((p + float2(0.6, 0.0)) * 0.45 + uSeed);
  float hy = vnoise((p + float2(0.0, 0.6)) * 0.45 + uSeed);
  float3 n = normalize(float3((h - hx) * 0.9, (h - hy) * 0.9, 1.0));
  float3 L = normalize(float3(uLight, 1.4));
  float diffuse = dot(n, L);
  float spec = pow(max(dot(n, normalize(L + float3(0.0, 0.0, 1.0))), 0.0), 30.0) * 0.16;
  float wave = fbm(p * 0.004 + uSeed);
  float3 col = uBase * (0.8 + 0.27 * diffuse + 0.07 * (wave - 0.5));
  col *= mix(1.07, 0.88, clamp(p.y / uSize.y, 0.0, 1.0));
  float2 q = min(p, uSize - p);
  float edge = min(q.x, q.y);
  float chip = step(0.74, fbm(p * 0.09 + uSeed * 3.0)) * (1.0 - smoothstep(1.5, 8.0, edge)) * uWear;
  col = mix(col, uPrimer, chip);
  col *= 1.0 - 0.07 * smoothstep(0.55, 0.9, fbm(p * 0.02 + uSeed * 1.3));
  return half4(half3(clamp(col + spec, 0.0, 1.0)), 1.0);
}
`;
