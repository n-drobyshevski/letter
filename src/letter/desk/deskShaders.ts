/**
 * The desk's SkSL (spec §5.4): wood (walnut or dark oak, the top, the apron, the drawer fronts and
 * the bare-oak drawer floors) and leather (the sous-main, and in felt mode the pen tray).
 * Skia-free strings, so node tests compile them with CanvasKit. Ported from the render prototypes
 * (`scratchpad/desk/render/wood.ts`, `leather.ts`) with the spec's fixes: colours come from presets,
 * the oak's arches and pores are toned down (`uArch`, pores at 0.5×), and fine detail fades out where
 * it would alias at the far (drawer) scale.
 *
 * Conventions: coordinates are the canvas's local points; distances in the grain are in mm
 * (`uScale` pt per mm), so the wood reads the same at any scale. One lamp: `uLamp` (x, y, height in
 * points, local to the canvas) gives a point source's irradiance (h / r)³ that maps shadow → base → lit
 * (the presets' colours), and `uLight` (LIGHT_DIR) lights the relief. Static: drawn once per canvas.
 */
import { NOISE } from '../shaders';

/** Three octaves of value noise (cheaper than NOISE's five-octave fbm). */
const FBM3 = /* sksl */ `
float fbm3(float2 p) {
  return 0.5714 * vnoise(p) + 0.2857 * vnoise(p * 2.03 + float2(17.1, 3.7)) + 0.1429 * vnoise(p * 4.12 + float2(5.3, 41.9));
}
// The lamp's irradiance at xy: 1 under the lamp, (h / r)^3 away from it (a point source on a plane).
float lampAt(float2 xy) {
  float2 d = xy - uLamp.xy;
  float h = max(uLamp.z, 1.0);
  return pow(h * inversesqrt(dot(d, d) + h * h), 3.0);
}
`;

/**
 * Wood, flat-sawn boards with the grain along x, each cut from its own log (a tilted cylinder of
 * rings gives the cathedral arches). Uniforms, in order:
 * - `uSize` (pt), `uSeed`, `uScale` (pt per mm);
 * - `uLit`, `uBase`, `uShadow` (the finished wood under the lamp, in general, far from it), `uPore`, `uSheen`;
 * - `uRingMm` (mean ring width), `uArch` (contrast of the rings, i.e. of the arches), `uRays` (oak ray flecks;
 *   > 0 also means ring-porous oak pores, at half the prototype's strength), `uBoards` (boards across a 600 mm top);
 * - `uLamp` (x, y, height: pt), `uLight`, `uFace` (1: a vertical face toward the viewer, about 25 % darker,
 *   no sheen), `uWearY` (y of the desk's near edge: a lighter, matte band above it; < 0 for none).
 */
export const WOOD_SKSL = /* sksl */ `
uniform float2 uSize;
uniform float uSeed;
uniform float uScale;
uniform float3 uLit;
uniform float3 uBase;
uniform float3 uShadow;
uniform float3 uPore;
uniform float3 uSheen;
uniform float uRingMm;
uniform float uArch;
uniform float uRays;
uniform float uBoards;
uniform float3 uLamp;
uniform float2 uLight;
uniform float uFace;
uniform float uWearY;
${NOISE}
${FBM3}
// Seams near multiples of bw. The first one (k = 0) always falls at or above y = 0, so the top's first
// seam is a board's width down: never a dark rule across the header at the top of a canvas.
float seam(float k, float bw) {
  float o = (hash(float2(k, uSeed + 3.1)) - 0.5) * 0.36;
  if (abs(k) < 0.5) { o = -abs(o); }
  return (k + o) * bw;
}
// The lamp's light as a colour factor on the base wood: shadow at 0, base at 0.5, lit at 1.
float3 lampTone(float I) {
  float3 t = I < 0.5 ? mix(uShadow, uBase, I * 2.0) : mix(uBase, uLit, I * 2.0 - 1.0);
  return t / max(uBase, float3(0.01));
}
half4 main(float2 xy) {
  float2 p = xy / uScale + float2(uSeed * 0.0131, 0.0);   // mm
  float bw = 600.0 / max(uBoards, 1.0);
  // Which board: seeded seams near multiples of bw.
  float k = floor(p.y / bw);
  float y0 = seam(k, bw);
  if (p.y < y0) { k -= 1.0; y0 = seam(k, bw); }
  float y1 = seam(k + 1.0, bw);
  if (p.y >= y1) { k += 1.0; y0 = y1; y1 = seam(k + 1.0, bw); }
  // One board (a drawer front, the apron): no seams on it.
  if (uBoards < 1.5) { k = 0.0; y0 = -400.0; y1 = 400.0 + uSize.y / uScale; }
  float W = y1 - y0;
  float v = p.y - y0;
  float h1 = hash(float2(k, uSeed + 1.0));
  float h2 = hash(float2(k, uSeed + 2.0));
  float h3 = hash(float2(k, uSeed + 4.0));
  float h4 = hash(float2(k, uSeed + 6.0));
  float x = p.x + h4 * 900.0;

  // The log under the board: rings are cylinders round an off-centre pith; the face is tilted to the
  // log's axis along its length, which draws the arches.
  float c = (h1 - 0.5) * W * 0.75 + 9.0 * (vnoise(float2(x * 0.003, k)) - 0.5);
  float d = mix(30.0, 190.0, h2) + x * (h3 - 0.5) * 0.24 + 14.0 * (vnoise(float2(x * 0.0022, k + 3.0)) - 0.5);
  d = max(d, 6.0);
  float spacing = uRingMm * mix(0.75, 1.3, h4);
  float warp = vnoise(float2(x * 0.005, v * 0.022) + k * 7.0) - 0.5;
  float r = length(float2(v - W * 0.5 - c, d)) + warp * 1.7;
  float year = r / spacing;
  year += 0.6 * (vnoise(float2(year * 0.23, k)) - 0.5);
  float t = fract(year);
  float ringVar = hash(float2(floor(year), k));
  // Rings closer than a few points would alias: fade them to their mean tone.
  float lod = smoothstep(2.5, 6.0, spacing * uScale);
  // Latewood darkens through the year and gives way to the next spring's wood; walnut (diffuse-porous)
  // over a wider band, so a broad arch fades out rather than ending in a hard outline.
  float edgeIn = uRays > 0.0 ? 0.975 : 0.9;
  float late = smoothstep(0.35, 0.97, t) * (1.0 - smoothstep(edgeIn, 1.0, t)) * mix(0.55, 1.0, ringVar);
  float g = 1.0 - 0.17 * uArch * mix(0.33, late, lod);

  // Fibres: long streaks along the grain, never finer than ~2 pt across.
  float fq = min(1.2, uScale * 0.35);
  float fib = vnoise(float2(x * 0.18, v * fq + k * 3.0));
  float fib2 = vnoise(float2(x * 0.03, v * fq * 0.3 + k));
  g *= 0.975 + 0.035 * fib + 0.05 * (fib2 - 0.5);

  // Pores: short dark dashes along the grain. Oak (uRays > 0) is ring-porous: a band of them starts
  // each ring (its visible grain line); walnut is diffuse-porous: sparse, everywhere.
  // Pores are ~0.15 mm across: below ~1.2 pt per mm they merge into the band's tone.
  float plod = smoothstep(1.0, 2.2, uScale);
  float pz = vnoise(float2(x * 0.5, v * min(2.6, uScale * 1.1) + 17.0 + k));
  float pore = 0.0;
  if (uRays > 0.0) {
    float band = smoothstep(0.0, 0.03, t) * (1.0 - smoothstep(0.1, 0.26 + 0.1 * ringVar, t)) * lod;
    g *= 1.0 - 0.14 * uArch * band;
    pore = 0.5 * plod * (band * smoothstep(0.62, 0.88, pz) * 0.8 + (1.0 - band) * smoothstep(0.88, 0.96, pz) * 0.25);
    // Rays: tiny lens flecks along the grain, a touch darker and redder.
    float2 cell = float2(floor(x / 3.2), floor(v / 0.9));
    float2 q = float2(fract(x / 3.2), fract(v / 0.9));
    float len = mix(0.25, 0.9, hash(cell + 11.0));
    float2 cq = (q - float2(0.5)) / float2(len * 0.5, 0.18);
    float ray = step(0.72, hash(cell + k)) * (1.0 - smoothstep(0.6, 1.0, length(cq))) * smoothstep(1.5, 3.0, uScale);
    g *= 1.0 - 0.1 * uRays * ray;
  } else {
    pore = smoothstep(0.82, 0.95, pz) * 0.32 * mix(0.4, 1.0, plod);
    // Walnut figure: soft streaks and a grey-violet mineral cast in places.
    float streak = fbm3(float2(x * 0.004, v * 0.09 + k * 5.0));
    g *= 0.93 + 0.14 * streak;
  }
  // Each board its own stock; a slow drift across the desk.
  g *= 0.955 + 0.07 * h1;
  g *= 0.97 + 0.06 * vnoise(p * 0.004 + uSeed * 0.01);
  float3 col = uBase * g * float3(1.0, 0.99 + 0.02 * h3, 0.985 + 0.03 * h2);
  col = mix(col, uPore * (col / max(uBase, float3(0.01))), pore);
  if (uRays <= 0.0) {
    float mineral = smoothstep(0.66, 0.82, vnoise(float2(x * 0.0035, v * 0.2 + k * 2.0)));
    col = mix(col, col * float3(0.9, 0.89, 0.95), mineral * 0.6);
  }

  // The lamp.
  float I = lampAt(xy);
  float3 L = lampTone(I);
  if (uFace > 0.5) {
    // A vertical face toward the viewer: lit at a grazing angle, darker, a touch brighter at the top.
    L = lampTone(I * 0.8) * (0.78 - 0.06 * (xy.y / max(uSize.y, 1.0)));
  }
  col *= L;

  // Seams: a shallow dark gap between two small chamfers (at most ~8 L* below the boards); the chamfer
  // facing the lamp (-y) is a lit lip a pixel or so wide.
  float px = 1.0 / uScale;
  float dTop = v;
  float dBot = W - v;
  float gap = 0.15;
  float cham = 0.5;
  float seamDark = 1.0 - smoothstep(gap, gap + px * 1.2, min(dTop, dBot));
  float litWall = (1.0 - smoothstep(gap, cham, dTop)) * step(gap, dTop);
  float shadeWall = (1.0 - smoothstep(gap, cham, dBot)) * step(gap, dBot);
  col *= 1.0 + 0.3 * litWall * -uLight.y - 0.1 * shadeWall;
  col = mix(col, col * 0.78, seamDark * 0.8);

  // Worn near edge: the shellac thin, lighter and matte where forearms rest.
  float wear = 0.0;
  if (uWearY > 0.0) {
    wear = smoothstep(uWearY - 70.0 * uScale, uWearY - 3.0 * uScale, xy.y) * step(xy.y, uWearY) * (0.6 + 0.4 * vnoise(p * 0.05));
    col *= 1.0 + 0.16 * wear;
    col = mix(col, float3(dot(col, float3(0.3, 0.55, 0.15))), 0.12 * wear);
  }
  // Satin sheen under the lamp, broken by the pores and fibres (shellac: deep, not mirror).
  if (uFace < 0.5) {
    float s = 0.3 * pow(I, 5.0) * (1.0 - 1.4 * pore) * (0.75 + 0.5 * fib) * (1.0 - 0.7 * wear);
    col = mix(col, uSheen, clamp(s, 0.0, 1.0));
  }
  return half4(half3(clamp(col, 0.02, 0.98)), 1.0);
}
`;

/**
 * Leather over a board (the sous-main), or felt (`uFelt` 1, the pen tray). Drawn in its own local
 * coordinates: the pad fills (0, 0)–`uSize`, a rounded rect of radius `uRadius` (pt). Uniforms, in order:
 * `uSize`, `uSeed`, `uScale` (pt per mm), `uColor`, `uGilt`, `uFillet` (gilt fillet insets in pt; 0 for
 * none), `uRadius`, `uFelt`, `uLamp` (x, y, height: pt, pad-local), `uLight`, `uRest` (the hand-rest
 * centre, pt, pad-local: burnished).
 */
export const LEATHER_SKSL = /* sksl */ `
uniform float2 uSize;
uniform float uSeed;
uniform float uScale;
uniform float3 uColor;
uniform float3 uGilt;
uniform float2 uFillet;
uniform float uRadius;
uniform float uFelt;
uniform float3 uLamp;
uniform float2 uLight;
uniform float2 uRest;
${NOISE}
${FBM3}
float sdRound(float2 q, float2 b, float r) {
  float2 e = abs(q) - b + r;
  return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - r;
}
// Signed distance to the pad's edge in mm (negative inside).
float edgeMm(float2 xy) {
  return sdRound(xy - uSize * 0.5, uSize * 0.5, uRadius) / uScale;
}
// Distance (pt) from a tooled line inset by \`inset\` pt.
float toolPt(float2 xy, float inset) {
  return abs(sdRound(xy - uSize * 0.5, uSize * 0.5 - inset, max(uRadius - inset, 1.0)));
}
float groovePt() {
  return uFillet.x - 2.4 * uScale;
}
float height(float2 xy) {
  float2 p = xy / uScale + uSeed;
  float e = edgeMm(xy);
  // The leather rolls over the board's edge in its last ~2.2 mm.
  float roll = 1.0 - smoothstep(-2.2, 0.0, e);
  float h = roll * roll * 0.8;
  if (uFelt > 0.5) {
    return h + 0.05 * vnoise(p * 3.2) + 0.03 * vnoise(p * 7.1);
  }
  // Pebble grain (~0.7 mm cells, finer breaks), and a few long, faint creases.
  float gr = vnoise(p * 1.45);
  h += 0.07 * gr * gr + 0.025 * vnoise(p * 3.1 + 7.0);
  float cr = abs(fbm3(p * float2(0.05, 0.11) + 3.0) - 0.5);
  h -= 0.03 * (1.0 - smoothstep(0.0, 0.025, cr));
  // A blind-tooled groove outside the gilt fillet.
  if (uFillet.x > 0.0 && groovePt() > 2.0 * uScale) {
    h -= 0.22 * (1.0 - smoothstep(0.15 * uScale, 0.6 * uScale, toolPt(xy, groovePt())));
  }
  return h;
}
float toneOf(float I) {
  return I < 0.5 ? mix(0.66, 1.0, I * 2.0) : mix(1.0, 1.24, I * 2.0 - 1.0);
}
half4 main(float2 xy) {
  float e = edgeMm(xy);
  float aa = 1.0 / uScale;
  float cover = 1.0 - smoothstep(-aa, aa * 0.5, e);
  if (cover <= 0.0) { return half4(0.0); }
  float2 p = xy / uScale + uSeed;
  float dd = 0.6;
  float h0 = height(xy);
  float hx = height(xy + float2(dd, 0.0));
  float hy = height(xy + float2(0.0, dd));
  float kk = uScale * 0.55;
  float3 n = normalize(float3((h0 - hx) * kk / dd, (h0 - hy) * kk / dd, 1.0));
  float3 L = normalize(float3(uLight, 1.25));
  float relief = max(dot(n, L), 0.0) / L.z;
  float I = lampAt(xy);
  float tone = toneOf(I);
  float3 col = uColor;
  float3 lit;
  if (uFelt > 0.5) {
    // Felt: matted fibres, a few pills, no sheen at all.
    float fuzz = vnoise(p * 2.4) * 0.6 + vnoise(p * 5.3 + 3.0) * 0.4;
    float pill = smoothstep(0.8, 0.95, vnoise(p * 1.1 + 9.0));
    col *= 0.9 + 0.14 * fuzz + 0.12 * (fbm3(p * 0.06) - 0.5);
    col = mix(col, col * 1.18, pill * 0.3);
    lit = col * tone * (0.62 + 0.38 * relief);
  } else {
    // Aniline mottling, darker towards the handled edges, burnished where the hand rests.
    col *= 0.9 + 0.2 * fbm3(p * 0.035);
    col *= 0.93 + 0.07 * smoothstep(-14.0, -3.0, -e - 3.0);
    float2 dr = (xy - uRest) / uScale;
    float rest = exp(-dot(dr, dr) / 3200.0);
    col *= 1.0 + 0.1 * rest;
    lit = col * tone * (0.5 + 0.5 * relief);
    float3 H = normalize(L + float3(0.0, 0.0, 1.0));
    float nh = max(dot(n, H), 0.0);
    lit += float3(1.0, 0.93, 0.82) * pow(nh, mix(14.0, 26.0, rest)) * mix(0.05, 0.1, rest) * (0.4 + 0.6 * I);
    // Gilt fillets: thin lines of gold leaf, worn through in patches, metallic.
    float line = 0.0;
    float hw = max(0.2 * uScale, 0.35);
    if (uFillet.x > 0.0) { line = max(line, 1.0 - smoothstep(hw, hw + 0.6, toolPt(xy, uFillet.x))); }
    if (uFillet.y > 0.0) { line = max(line, 1.0 - smoothstep(hw, hw + 0.6, toolPt(xy, uFillet.y))); }
    if (line > 0.0) {
      // 40–70 % of the leaf left, in patches along the line.
      float worn = smoothstep(0.25, 0.55, vnoise(p * 0.16 + 11.0)) * (0.7 + 0.3 * smoothstep(0.2, 0.5, vnoise(p * 1.9 + 4.0)));
      float3 gl = uGilt * (0.62 + 0.3 * tone) * (0.78 + 0.22 * relief) + uGilt * pow(nh, 10.0) * 0.18;
      lit = mix(lit, gl, line * (0.3 + 0.6 * worn));
    }
  }
  // The very edge: the turned-over leather darkens into the gap.
  lit *= 0.78 + 0.22 * smoothstep(-0.25, -1.0, e);
  return half4(half3(clamp(lit, 0.02, 0.98)) * cover, cover);
}
`;

/**
 * A round part lying on the desk (a pen's barrel, section, nib cone), drawn in the part's own frame:
 * x along its axis from 0 to `uLen`, y across, centred on the axis (radius `uRad` at each end, pt).
 * The cross-section's normal comes from y / r; Lambert plus Blinn under `uLight` (the desk light turned
 * into this frame). `uPattern`: 0 plain, 1 marbled celluloid, 2 celluloid stripes along the barrel,
 * 3 a twisted glass helix (pitch `uPatternScale` pt) with `uColor2` (ink) in its grooves.
 * `uMetal` tints the highlight by the colour. `uAlpha` < 1 is clear glass: the felt shows through it
 * (`uAlpha` in the middle), its silhouettes thicken (Fresnel), a bright line runs along the lamp's side
 * and a dark refraction line just inside the far silhouette; the twist shows as lighter facets, and ink
 * (`uColor2` ≠ `uColor`) lies only in the grooves, denser toward the tip (+x). Opaque parts are never
 * shaded below half their colour (black resin stays a very dark brown, never black).
 */
export const PEN_SKSL = /* sksl */ `
uniform float uLen;
uniform float2 uRad;
uniform float3 uColor;
uniform float3 uColor2;
uniform float uPattern;
uniform float uPatternScale;
uniform float uGloss;
uniform float uSpec;
uniform float uMetal;
uniform float2 uLight;
uniform float uSeed;
uniform float uAlpha;
${NOISE}
half4 main(float2 xy) {
  float r = mix(uRad.x, uRad.y, clamp(xy.x / max(uLen, 1.0), 0.0, 1.0));
  float s = xy.y / max(r, 0.01);
  float as = abs(s);
  if (as > 1.06) { return half4(0.0); }
  float3 n = float3(0.0, clamp(s, -1.0, 1.0), sqrt(max(1.0 - s * s, 0.0)));
  float3 L = normalize(float3(uLight, 1.15));
  float diff = max(dot(n, L), 0.0);
  float3 H = normalize(L + float3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, H), 0.0), uGloss) * uSpec;
  float3 col = uColor;
  float groove = 0.0;
  if (uPattern > 0.5 && uPattern < 1.5) {
    float2 q = float2(xy.x * 0.02, s * 1.6 + uSeed);
    float m = vnoise(q + float2(vnoise(q * 1.7) * 1.2, 0.0));
    col = mix(uColor, uColor2, smoothstep(0.35, 0.75, m));
  } else if (uPattern > 1.5 && uPattern < 2.5) {
    // Laminated celluloid: translucent stripes along the barrel, a little wavy.
    float a = asin(clamp(s, -1.0, 1.0)) * 4.0 / 3.14159 + 0.15 * vnoise(float2(xy.x * 0.05, uSeed));
    float st = smoothstep(0.25, 0.45, abs(fract(a * uPatternScale * 0.25) - 0.5));
    col = mix(uColor, uColor2, st);
  } else if (uPattern > 2.5) {
    // Twisted glass: a helix of ridges; ink lies in the grooves.
    float a = asin(clamp(s, -1.0, 1.0)) / 3.14159;
    float h = fract(xy.x / max(uPatternScale, 0.5) + a * 1.5);
    groove = 1.0 - smoothstep(0.08, 0.3, abs(h - 0.5));
  }
  float rim = smoothstep(0.7, 1.0, as);
  float3 c;
  float alpha = uAlpha;
  if (uAlpha < 0.99) {
    // Clear glass. The lamp's side of the rod is the side of s that faces uLight.
    float ls = uLight.y < 0.0 ? -1.0 : 1.0;
    float fres = smoothstep(0.55, 1.0, as);
    float bright = exp(-pow((s - ls * 0.55) / 0.13, 2.0));
    float dark = exp(-pow((s + ls * 0.8) / 0.09, 2.0));
    float facet = 0.0;
    float ink = 0.0;
    if (uPattern > 2.5) {
      float a = asin(clamp(s, -1.0, 1.0)) / 3.14159;
      float h = fract(xy.x / max(uPatternScale, 0.5) + a * 1.5);
      facet = smoothstep(0.55, 1.0, 0.5 + 0.5 * cos(6.2832 * h));
      ink = groove * step(0.02, length(uColor2 - uColor)) * mix(0.55, 1.0, clamp(xy.x / max(uLen, 1.0), 0.0, 1.0));
    }
    c = uColor * (0.86 + 0.14 * diff) + float3(0.12 * facet);
    c = mix(c, uColor * 0.22, 0.75 * dark);
    c = mix(c, uColor2 * 0.75, ink);
    c += float3(0.9 * bright + spec);
    alpha = clamp(uAlpha + 0.38 * fres + 0.1 * facet + 0.55 * dark + 0.6 * bright + 0.8 * ink + spec, 0.0, 1.0);
  } else if (uMetal > 0.5) {
    float env = 0.35 + 0.65 * smoothstep(-0.2, 0.9, n.z * 0.6 + dot(n.xy, normalize(uLight)) * 0.5);
    c = col * (0.25 + 0.95 * env * diff) + col * spec * 1.6 + float3(spec * 0.25);
    c *= 1.0 - 0.35 * rim * (1.0 - diff);
  } else {
    c = col * (0.22 + 0.9 * diff) + float3(spec);
    c *= 1.0 - 0.35 * rim * (1.0 - diff);
    c = max(c, col * 0.5);
  }
  float aa = 1.0 - smoothstep(r - 0.6, r + 0.25, abs(xy.y));
  float a2 = aa * alpha;
  return half4(half3(clamp(c, 0.02, 0.98)) * a2, a2);
}
`;
