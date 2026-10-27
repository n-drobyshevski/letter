import {
  BlendMode,
  BlurStyle,
  ClipOp,
  PaintStyle,
  Skia,
  StrokeCap,
  TileMode,
  type SkCanvas,
  type SkColor,
  type SkPaint,
  type SkPath,
  type SkPicture,
  type SkRuntimeEffect,
} from '@shopify/react-native-skia';

import { mulberry32, subSeed, wobble } from '../../lib/random';
import type { EnvelopePaper, InkKind, LinerKind, SheetPaper } from '../../theme/kinds';
import { INKS, PAPERS, type PaperSpec, type Rgb } from '../../theme/stationery';
import { envelopeGeometry, recordEnvelope } from '../envelope';
import { LIGHT_DIR, paperUniforms } from '../paperLayout';
import { PAPER_SKSL } from '../shaders';
import { paperFor } from '../sheet';
import { PEN_SKSL } from './deskShaders';
import { rgb as hexRgb } from './deskUniforms';
import { ITEM_MM } from './layout';
import { PENS, type PenKey } from './types';

/**
 * Picture recorders for what lies in the drawers and on the desk (spec §3.1, §5.4), ported from the
 * render prototypes (`scratchpad/desk/render/stock.ts`, `pens.ts`) with the spec's fixes (a matte
 * knurled bottle cap with one broad, offset highlight; no brand anywhere).
 *
 * Every recorder takes a scale in pt per mm, so the same item draws at the drawer's far scale and at the
 * desk's near scale. A picture's origin is the item's rect top-left, unrotated: (0, 0)–(w, h) with
 * w × h its real size × scale (the slot rects of `drawerSlots`). Shadows spill outside it, away from the
 * light (bottom-right). Pens lie along x with the nib to the right (+x), centred on h / 2.
 *
 * Each picture is recorded once per (kind, scale, seed…) and kept in a module cache, like `dieCache`.
 */

// ---------------------------------------------------------------- helpers

const cache = new Map<string, SkPicture>();
/** Scales that differ by less than this share a picture. */
const q = (v: number) => Math.round(v * 100) / 100;

function cached(key: string, make: () => SkPicture): SkPicture {
  let p = cache.get(key);
  if (!p) {
    p = make();
    cache.set(key, p);
  }
  return p;
}

let paperEffect: SkRuntimeEffect | null = null;
let penEffect: SkRuntimeEffect | null = null;
function effects() {
  paperEffect ??= Skia.RuntimeEffect.Make(PAPER_SKSL);
  penEffect ??= Skia.RuntimeEffect.Make(PEN_SKSL);
  if (!paperEffect || !penEffect) throw new Error('Desk item shaders failed to compile');
  return { paper: paperEffect, pen: penEffect };
}

export const rgba = (r: number, g: number, b: number, a = 1): SkColor => Float32Array.of(r, g, b, a);
const shade = (c: Rgb, k: number, a = 1) => rgba(Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k), a);

export function fill(color: SkColor): SkPaint {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(color);
  return p;
}
export function stroke(color: SkColor, width: number): SkPaint {
  const p = fill(color);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(width);
  return p;
}
export function blurred(color: SkColor, sigma: number): SkPaint {
  const p = fill(color);
  if (sigma > 0.05) p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, sigma, true));
  return p;
}
export function record(bounds: { x: number; y: number; width: number; height: number }, draw: (c: SkCanvas) => void): SkPicture {
  const recorder = Skia.PictureRecorder();
  draw(recorder.beginRecording(Skia.XYWHRect(bounds.x, bounds.y, bounds.width, bounds.height)));
  return recorder.finishRecordingAsPicture();
}
const rrectPath = (x: number, y: number, w: number, h: number, r: number) =>
  Skia.PathBuilder.Make()
    .addRRect(Skia.RRectXY(Skia.XYWHRect(x, y, w, h), r, r))
    .detach();

/** LIGHT_DIR turned into a frame rotated by `angle` (radians, clockwise on screen). */
export function lightIn(angle: number) {
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  return { x: LIGHT_DIR.x * c - LIGHT_DIR.y * s, y: LIGHT_DIR.x * s + LIGHT_DIR.y * c };
}

/**
 * The shadow of `path` for an object `lift` pt above what it lies on: a soft one offset away from the
 * light (bottom-right on screen, whatever `angle` the picture will be drawn at), and a tight contact line.
 */
export function dropShadow(c: SkCanvas, path: SkPath, lift: number, strength = 0.35, angle = 0) {
  const l = lightIn(angle);
  c.save();
  c.translate(-l.x * lift, -l.y * lift);
  c.drawPath(path, blurred(rgba(0.05, 0.03, 0.015, strength), Math.max(0.5, lift * 0.85)));
  c.restore();
  const t = Math.max(0.25, lift * 0.12);
  c.save();
  c.translate(-l.x * t, -l.y * t);
  c.drawPath(path, blurred(rgba(0.04, 0.02, 0.01, strength * 0.8), Math.max(0.35, t * 0.8)));
  c.restore();
}

// ---------------------------------------------------------------- paper

/** A sheet outline, cut (straight) or deckled (a torn, uneven edge `deckle` pt deep). */
function sheetPath(w: number, h: number, rand: () => number, deckle = 0): SkPath {
  const b = Skia.PathBuilder.Make();
  if (deckle <= 0) return b.addRect(Skia.XYWHRect(0, 0, w, h)).detach();
  const n = Math.max(8, Math.round((w + h) / 4));
  const j = () => (rand() - 0.5) * deckle;
  const pts: [number, number][] = [];
  const nx = Math.round((n * w) / (w + h));
  const ny = n - nx;
  for (let i = 0; i < nx; i++) pts.push([(w * i) / nx, j()]);
  for (let i = 0; i < ny; i++) pts.push([w + j(), (h * i) / ny]);
  for (let i = 0; i < nx; i++) pts.push([w - (w * i) / nx, h + j()]);
  for (let i = 0; i < ny; i++) pts.push([j(), h - (h * i) / ny]);
  b.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) b.lineTo(x, y);
  return b.close().detach();
}

/**
 * About the writing sheet's scale (pt per mm). Envelopes are recorded at it and shrunk, so a small one
 * keeps the liner's pattern at its real size; paper is shaded at its own scale below it (shrunk rules
 * would alias) and scaled up above it.
 */
const SHADE_SCALE = 2.4;

/**
 * The paper shader for a `w` × `h` (pt) sheet drawn at `scale`: shaded at its own scale up to SHADE_SCALE,
 * then scaled up to fit. `shrink`: shaded at SHADE_SCALE whatever the scale (an unruled paper whose cockle
 * must keep its real size in mm; it has no printed rules to alias).
 */
function paperPaint(
  spec: PaperSpec,
  w: number,
  h: number,
  seed: number,
  scale = SHADE_SCALE,
  kind?: SheetPaper,
  shrink = false,
): SkPaint {
  // Never shrunk otherwise: the printed rules would thin below a pixel and alias (moiré) at the drawers' scale.
  const k = shrink ? scale / SHADE_SCALE : Math.max(1, scale / SHADE_SCALE);
  const size = { width: w / k, height: h / k };
  const p = Skia.Paint();
  p.setAntiAlias(true);
  const m = Skia.Matrix();
  m.scale(k, k);
  p.setShader(effects().paper.makeShader(paperUniforms(kind ? paperFor(kind, size.width) : spec, size, seed, 0), m));
  return p;
}

/** Sheet edges: the lamp-side edges catch the light, the far ones a hairline of shade. */
function sheetEdges(c: SkCanvas, w: number, h: number, scale: number, strength = 1) {
  const lw = Math.max(0.5, 0.16 * scale);
  const lit = stroke(rgba(1, 0.98, 0.94, 0.45 * strength), lw);
  c.drawLine(0, 0, w, 0, lit);
  c.drawLine(0, 0, 0, h, lit);
  const dark = stroke(rgba(0.25, 0.19, 0.13, 0.3 * strength), lw);
  c.drawLine(w, 0, w, h, dark);
  c.drawLine(0, h, w, h, dark);
}

/** Paper in the drawer's stacks: what the sheet shader draws for each kind, scaled to the stack. */
const CALIPER: Record<SheetPaper, number> = { grid: 0.075, seyes: 0.11, cotton: 0.13, airmail: 0.045 };
const STACK_COUNT: Record<SheetPaper, number> = { grid: 5, seyes: 6, cotton: 4, airmail: 4 };

/**
 * A stack of loose sheets (`size` in mm: A5 in the drawer, an A6-cropped supply on the laptop desk).
 * Never aligned: each sheet under the top one shows only as an edge; only the top sheet runs the paper
 * shader. Per kind: a notebook double leaf with its two staple holes on the fold and a pink blotter
 * under the stack; Seyès copies doubles fanned out of a plain grey-blue card sleeve; cotton with a
 * deckle edge and a cream paper band; airmail onion skin, the edges of the sheets under it showing through.
 */
export function recordPaperStack(
  kind: SheetPaper,
  scale: number,
  seed: number,
  size: { w: number; h: number } = ITEM_MM.stack,
): SkPicture {
  return cached(`paper:${kind}:${q(scale)}:${seed}:${size.w}x${size.h}`, () => {
    const w = size.w * scale;
    const h = size.h * scale;
    const rand = mulberry32(subSeed(seed, 'stack'));
    const spec = paperFor(kind, w);
    const count = STACK_COUNT[kind];
    const jit = 1.1 * scale;
    // A deckle edge is a torn millimetre or so: still visible at the drawer's scale.
    const deckle = kind === 'cotton' ? Math.max(0.8, 1.1 * scale) : 0;
    return record({ x: -0.15 * w, y: -0.15 * h, width: 1.3 * w, height: 1.3 * h }, (c) => {
      // The pink blotter (промокашка) lies under the notebook leaf, a corner showing.
      if (kind === 'grid') {
        const bw = w * 0.86;
        const bh = h * 0.6;
        c.save();
        c.translate(w * 0.2, h * 0.44);
        c.rotate(4 + wobble(rand, 2), bw / 2, bh / 2);
        const blot = Skia.PathBuilder.Make()
          .addRect(Skia.XYWHRect(0, 0, bw, bh))
          .detach();
        dropShadow(c, blot, 0.5 * scale, 0.25);
        const pink: PaperSpec = { ...PAPERS.cotton, base: [0.9, 0.74, 0.73], cell: 0, ruling: 'none', cockle: 0 };
        c.drawPath(blot, paperPaint(pink, bw, bh, seed + 31, scale));
        sheetEdges(c, bw, bh, scale, 0.6);
        c.restore();
      }
      // The whole stack's contact shadow: its height lifts it a little.
      const footprint = Skia.PathBuilder.Make()
        .addRect(Skia.XYWHRect(-jit / 2, -jit / 2, w + jit, h + jit))
        .detach();
      dropShadow(c, footprint, (0.4 + count * CALIPER[kind] * 1.5) * scale, 0.3);
      const unders: { dx: number; dy: number; da: number; path: SkPath }[] = [];
      let topSheet: { dx: number; dy: number; da: number; path: SkPath } | null = null;
      for (let i = 0; i < count; i++) {
        const top = i === count - 1;
        // Copies doubles fan out of their sleeve; everything else is just never aligned.
        const fan = kind === 'seyes' ? (i - (count - 1) / 2) * 0.7 : 0;
        // Onion skin: the two sheets under the top one stick out 2–4 mm up and to the right, so their
        // edges show beside it and, through it, as ghosts.
        const peek = kind === 'airmail' && !top && i >= count - 3 ? (count - 1 - i) * (2.2 + 1.5 * rand()) * scale : 0;
        const dx = wobble(rand, jit) + (kind === 'seyes' ? fan * scale * 0.6 : 0) + peek;
        const dy = wobble(rand, jit) - (kind === 'seyes' ? Math.abs(fan) * scale * 0.4 : 0) - peek * 0.8;
        const da = top ? wobble(rand, 0.25) : wobble(rand, 0.7) + fan;
        const path = sheetPath(w, h, rand, deckle);
        c.save();
        c.translate(dx, dy);
        c.rotate(da, w / 2, h / 2);
        if (i > 0) {
          // The sheet's own hairline of shadow on the one below.
          c.save();
          c.translate(0.1 * scale, 0.2 * scale);
          c.drawPath(path, blurred(rgba(0.15, 0.1, 0.05, 0.2), 0.3 * scale));
          c.restore();
        }
        if (top) topSheet = { dx, dy, da, path };
        if (top && kind === 'airmail') {
          // Shaded at the writing sheet's scale and shrunk, so its cockle keeps its size in mm; a little
          // stronger in the drawer, where it is all that says "onion skin".
          c.drawPath(path, paperPaint({ ...spec, cockle: scale < 1.5 ? 1.8 : 1 }, w, h, seed, scale, undefined, true));
        } else if (top) {
          c.drawPath(path, paperPaint(spec, w, h, seed, scale, kind));
        } else {
          const t = 0.955 + 0.04 * rand();
          c.drawPath(path, fill(shade(spec.base, t)));
          unders.push({ dx, dy, da, path });
        }
        sheetEdges(c, w, h, scale);
        // The notebook leaf is folded on its left edge: two staples went through the fold.
        if (top && kind === 'grid') {
          const hole = fill(rgba(0.32, 0.28, 0.26, 0.75));
          for (const fy of [0.27, 0.73]) {
            for (const d of [-3.2, 3.2]) c.drawCircle(1.2 * scale, h * fy + d * scale, Math.max(0.35, 0.3 * scale), hole);
          }
          c.drawLine(0.4, 0, 0.4, h, stroke(rgba(0.3, 0.25, 0.2, 0.18), Math.max(0.5, 0.25 * scale)));
        }
        c.restore();
      }
      // Onion skin: the sheets under the top one show through it.
      if (kind === 'airmail') {
        const ghost = stroke(rgba(0.35, 0.32, 0.28, 0.35), Math.max(0.6, 0.25 * scale));
        c.save();
        // Only through the top sheet: beside it the real edges show.
        if (topSheet) {
          c.translate(topSheet.dx, topSheet.dy);
          c.rotate(topSheet.da, w / 2, h / 2);
          c.clipPath(topSheet.path, ClipOp.Intersect, true);
          c.rotate(-topSheet.da, w / 2, h / 2);
          c.translate(-topSheet.dx, -topSheet.dy);
        }
        for (const u of unders.slice(-2)) {
          c.save();
          c.translate(u.dx, u.dy);
          c.rotate(u.da, w / 2, h / 2);
          c.drawPath(u.path, ghost);
          c.restore();
        }
        c.restore();
      }
      // Cotton: a cream paper band round the stack, high enough to show in the drawer's stagger.
      if (kind === 'cotton') {
        const by = h * 0.12;
        const bh = 24 * scale;
        const band = Skia.PathBuilder.Make()
          .addRect(Skia.XYWHRect(-0.8 * scale, by, w + 1.6 * scale, bh))
          .detach();
        dropShadow(c, band, 0.35 * scale, 0.28);
        const cream: PaperSpec = { ...PAPERS.cream, cell: 0 };
        c.drawPath(band, paperPaint(cream, w, bh, seed + 17, scale));
        c.drawLine(-0.8 * scale, by, w + 0.8 * scale, by, stroke(rgba(1, 0.97, 0.9, 0.5), Math.max(0.5, 0.2 * scale)));
        c.drawLine(
          -0.8 * scale,
          by + bh,
          w + 0.8 * scale,
          by + bh,
          stroke(rgba(0.3, 0.22, 0.14, 0.3), Math.max(0.5, 0.2 * scale)),
        );
      }
      // Seyès: the sleeve, a plain grey-blue card folder holding most of the stack, with a thumb cut; its
      // mouth is high enough to show in the drawer's stagger.
      if (kind === 'seyes') {
        const sx = -1.5 * scale;
        const sy = h * 0.3;
        const sw = w + 3 * scale;
        const sh = h * 0.7 + 1.5 * scale;
        const r = 9 * scale;
        // In the sleeve's own coordinates: (0, 0) is the top of its thumb cut's circle.
        const sleeve = Skia.PathBuilder.Make()
          .moveTo(0, r)
          .lineTo(sw / 2 - r, r)
          .arcToOval(Skia.XYWHRect(sw / 2 - r, 0, 2 * r, 2 * r), 180, -180, false)
          .lineTo(sw, r)
          .lineTo(sw, r + sh)
          .lineTo(0, r + sh)
          .close()
          .detach();
        c.save();
        c.translate(sx, sy - r);
        dropShadow(c, sleeve, 0.45 * scale, 0.3);
        const card: PaperSpec = { ...PAPERS.kraft, base: [0.56, 0.62, 0.68], cell: 0 };
        c.drawPath(sleeve, paperPaint(card, sw, sh + r, seed + 23, scale));
        // The card is not quite flat: one fold line where its flap turns under.
        c.drawLine(
          0,
          r + sh - 6 * scale,
          sw,
          r + sh - 6 * scale,
          stroke(rgba(0.2, 0.22, 0.26, 0.22), Math.max(0.5, 0.25 * scale)),
        );
        c.drawPath(sleeve, stroke(rgba(1, 1, 1, 0.2), Math.max(0.5, 0.18 * scale)));
        c.restore();
      }
    });
  });
}

// ---------------------------------------------------------------- envelopes

/**
 * A C6 envelope from the stock, back up. In the drawer its closing flap stands open, leaning back so it
 * reads 40 mm deep, its liner and gum showing (the slot is `ITEM_MM.envelope`: the flap on top, the body
 * under it). Closed (`flapOpen` false, the laptop's resting one) it is `ITEM_MM.envelopeClosed`.
 */
export function recordEnvelopeStock(
  paper: EnvelopePaper,
  liner: LinerKind,
  scale: number,
  seed: number,
  flapOpen = true,
  pixelRatio = 2,
): SkPicture {
  return cached(`envelope:${paper}:${liner}:${q(scale)}:${seed}:${flapOpen}:${pixelRatio}`, () => {
    const w = ITEM_MM.envelope.w * scale;
    const flapH = flapOpen ? (ITEM_MM.envelope.h - ITEM_MM.envelopeClosed.h) * scale : 0;
    // The flap stands fairly upright: it reads 30 mm deep, its tip 10 mm below the slot's top.
    const standH = flapOpen ? Math.min(flapH, 30 * scale) : 0;
    // Recorded at SHADE_SCALE and shrunk, so the liner's pattern and the pulp keep their real size.
    const k = scale / SHADE_SCALE;
    const g = envelopeGeometry(ITEM_MM.envelope.w * SHADE_SCALE, seed, 'C6');
    // The liner's lines fade to their mean tone where they would alias: the pocket shrunk by k, the
    // standing flap foreshortened further (its own parts, at its own pitch).
    const px = (s: number) => s * pixelRatio * Math.SQRT1_2;
    const parts = recordEnvelope(g, paper, liner, seed, px(k));
    const flapParts = flapOpen ? recordEnvelope(g, paper, liner, seed, px(Math.min(k, standH / g.flapTip))) : parts;
    const bodyH = g.height * k;
    const total = flapH + bodyH;
    return record({ x: -0.1 * w, y: -0.1 * total, width: 1.2 * w, height: 1.3 * total }, (c) => {
      const body = rrectPath(0, flapH, w, bodyH, 0.6 * scale);
      dropShadow(c, body, 1.1 * scale, 0.32);
      c.save();
      c.translate(0, flapH);
      c.save();
      c.scale(k, k);
      if (flapOpen) {
        c.drawPicture(parts.interior);
        c.drawPicture(parts.pocket);
      } else {
        c.drawPicture(parts.pocket);
        c.drawPicture(parts.flapOuter);
      }
      c.restore();
      if (flapOpen) {
        // The open flap leans back from its hinge: its inside (liner, gum) foreshortened to flapH.
        c.save();
        c.scale(k, -standH / g.flapTip);
        c.drawPicture(flapParts.flapInner);
        // Leaning away from the lamp a little: darker towards the hinge.
        const sh = Skia.Paint();
        sh.setAntiAlias(true);
        sh.setShader(
          Skia.Shader.MakeLinearGradient(
            { x: 0, y: 0 },
            { x: 0, y: g.flapTip },
            [rgba(0.1, 0.06, 0.03, 0.34), rgba(0.1, 0.06, 0.03, 0.08)],
            null,
            TileMode.Clamp,
          ),
        );
        c.drawPath(g.flap, sh);
        // Its edge catches the lamp: it reads as a flap standing, not a printed triangle.
        c.drawPath(g.flap, stroke(rgba(1, 0.97, 0.9, 0.3), Math.max(0.5, 0.2 * scale) / k));
        c.restore();
        // The hinge: a lit crease, and the flap's shadow on the inside just below it.
        c.drawLine(0, 0, w, 0, stroke(rgba(1, 0.97, 0.9, 0.35), Math.max(0.5, 0.2 * scale)));
        const hs = Skia.Paint();
        hs.setShader(
          Skia.Shader.MakeLinearGradient(
            { x: 0, y: 0 },
            { x: 0, y: 3 * scale },
            [rgba(0.1, 0.06, 0.02, 0.22), rgba(0.1, 0.06, 0.02, 0)],
            null,
            TileMode.Clamp,
          ),
        );
        c.drawRect(Skia.XYWHRect(0, 0, w, 3 * scale), hs);
      }
      sheetEdges(c, w, bodyH, scale, 0.7);
      c.restore();
    });
  });
}

// ---------------------------------------------------------------- pens

/**
 * Ink as a liquid (in a bottle, on a nib): iron gall goes on blue-grey and only darkens to brown on the
 * paper (its `wet` colour); the others are their own colour.
 */
export const liquidOf = (ink: InkKind): Rgb => (ink === 'ironGall' ? hexRgb(INKS.ironGall.wet) : INKS[ink].rgb);

type Mat = {
  color: Rgb;
  color2?: Rgb;
  pattern?: number;
  patternScale?: number;
  gloss: number;
  spec: number;
  metal?: boolean;
  alpha?: number;
};

const MATS = {
  bordeaux: { color: [0.32, 0.055, 0.075], color2: [0.45, 0.1, 0.11], pattern: 1, gloss: 70, spec: 0.5 },
  // Black hard rubber is never quite black: a warm, very dark brown.
  ebonite: { color: [0.088, 0.075, 0.068], gloss: 50, spec: 0.4 },
  greenStripes: { color: [0.06, 0.17, 0.1], color2: [0.3, 0.46, 0.3], pattern: 2, patternScale: 7, gloss: 70, spec: 0.5 },
  steel: { color: [0.72, 0.73, 0.75], gloss: 40, spec: 0.8, metal: true },
  gold: { color: [0.8, 0.6, 0.3], gloss: 35, spec: 0.85, metal: true },
} satisfies Record<string, Mat>;

/** One round part from x0 (pt) along the axis at y = cy, radius r0 → r1, its ends optionally rounded. */
function part(
  c: SkCanvas,
  cy: number,
  x0: number,
  len: number,
  r0: number,
  r1: number,
  mat: Mat,
  seed: number,
  angle: number,
  round: [number, number] = [0, 0],
) {
  const l = lightIn(angle);
  const m = Skia.Matrix();
  m.translate(x0, cy);
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setShader(
    effects().pen.makeShader(
      [
        len,
        r0,
        r1,
        ...mat.color,
        ...(mat.color2 ?? mat.color),
        mat.pattern ?? 0,
        mat.patternScale ?? 1,
        mat.gloss,
        mat.spec,
        mat.metal ? 1 : 0,
        l.x,
        l.y,
        seed % 97,
        mat.alpha ?? 1,
      ],
      m,
    ),
  );
  const rr = Math.max(r0, r1) + 0.5;
  c.save();
  if (round[0] > 0 || round[1] > 0) {
    // A capsule clip rounds the ends (a finial, a section's lip).
    c.clipRRect(Skia.RRectXY(Skia.XYWHRect(x0, cy - rr, len, 2 * rr), Math.max(round[0], round[1]), rr), ClipOp.Intersect, true);
  }
  c.drawRect(Skia.XYWHRect(x0, cy - rr, len, 2 * rr), paint);
  c.restore();
}

/** A nib from its shoulders at x0 to the tip, `len` long, `half` its half-width at the shoulders, `tip` its half-width at the point. */
function nib(
  c: SkCanvas,
  cy: number,
  x0: number,
  len: number,
  half: number,
  tip: number,
  metal: Rgb,
  ink: Rgb,
  mm: number,
  angle: number,
) {
  const path = Skia.PathBuilder.Make()
    .moveTo(x0, cy - half)
    .cubicTo(x0 + len * 0.45, cy - half * 1.05, x0 + len * 0.8, cy - half * 0.45, x0 + len, cy - tip)
    .lineTo(x0 + len, cy + tip)
    .cubicTo(x0 + len * 0.8, cy + half * 0.45, x0 + len * 0.45, cy + half * 1.05, x0, cy + half)
    .close()
    .detach();
  const l = lightIn(angle);
  // Its shadow on the felt: the nib floats a little above it.
  c.save();
  c.translate(-l.x * 1.2 * mm, -l.y * 1.2 * mm);
  c.drawPath(path, blurred(rgba(0, 0, 0, 0.3), 0.8 * mm));
  c.restore();
  // A curved shell: brighter on the lamp's side.
  const p = Skia.Paint();
  p.setAntiAlias(true);
  const lit = l.y < 0 ? -half : half;
  p.setShader(
    Skia.Shader.MakeLinearGradient(
      { x: 0, y: cy + lit },
      { x: 0, y: cy - lit },
      [shade(metal, 1.25), shade(metal, 1.02), shade(metal, 0.55)],
      [0, 0.4, 1],
      TileMode.Clamp,
    ),
  );
  c.drawPath(path, p);
  // Breather hole, slit, and ink on the tines.
  const dark = fill(rgba(0.07, 0.05, 0.04, 0.9));
  c.drawCircle(x0 + len * 0.45, cy, Math.max(0.3, 0.55 * mm), dark);
  c.drawLine(x0 + len * 0.45, cy, x0 + len - 0.1 * mm, cy, stroke(rgba(0.07, 0.05, 0.04, 0.9), Math.max(0.3, 0.2 * mm)));
  c.drawCircle(x0 + len - 0.5 * mm, cy, Math.max(0.3, Math.max(tip, 0.5 * mm)), fill(rgba(ink[0], ink[1], ink[2], 0.7)));
}

/**
 * A pen lying uncapped (`open`) or capped, nib to the right, in its rect (length × barrel diameter):
 * - fine: a modern fountain pen, bordeaux lacquer, steel trim, a fine steel nib;
 * - broad: an old pen in green-striped celluloid, gold rings, a broad gold nib (no brand);
 * - glass: a twisted clear glass dip pen, ink in the grooves of its point.
 * `angle` is the turn it will be drawn at (radians, clockwise), so the light and shadow stay right on screen.
 */
export function recordPen(key: PenKey, scale: number, open = true, angle = 0, ink: InkKind = 'blueBlack'): SkPicture {
  return cached(`pen:${key}:${q(scale)}:${open}:${q(angle)}:${ink}`, () => {
    const mm = scale;
    const L = PENS[key].lengthMm * mm;
    const D = ITEM_MM.penDiameter[key] * mm;
    const R = D / 2;
    const cy = R;
    const inkRgb = liquidOf(ink);
    return record({ x: -10 * mm, y: -10 * mm, width: L + 20 * mm, height: D + 20 * mm }, (c) => {
      // Shadow of the silhouette: the barrel's capsule and the tapering front.
      const front = key === 'glass' ? 124 * mm : key === 'broad' ? 76 * mm : 84 * mm;
      const sil = Skia.PathBuilder.Make()
        .addRRect(Skia.RRectXY(Skia.XYWHRect(0, cy - R, front, 2 * R), R * 0.9, R * 0.9))
        .moveTo(front - 1, cy - R * 0.8)
        .lineTo(L, cy - 0.3 * mm)
        .lineTo(L, cy + 0.3 * mm)
        .lineTo(front - 1, cy + R * 0.8)
        .close()
        .detach();
      dropShadow(c, sil, R * 0.7, key === 'glass' ? 0.16 : 0.4, angle);
      if (key === 'fine') {
        const b = MATS.bordeaux;
        part(c, cy, 0, 7 * mm, R * 0.86, R * 0.95, b, 3, angle, [R * 0.9, 0]);
        part(c, cy, 7 * mm, 76 * mm, R * 0.95, R * 0.97, b, 4, angle);
        part(c, cy, 83 * mm, 2 * mm, R * 0.97, R * 0.97, MATS.steel, 1, angle);
        if (open) {
          part(c, cy, 85 * mm, 24 * mm, R * 0.74, R * 0.56, MATS.ebonite, 1, angle, [0, R * 0.25]);
          nib(c, cy, 107 * mm, 22 * mm, 2.9 * mm, 0.22 * mm, MATS.steel.color, inkRgb, mm, angle);
        } else {
          part(c, cy, 83 * mm, 50 * mm, R * 1.02, R * 0.9, b, 5, angle, [0, R * 0.9]);
        }
      } else if (key === 'broad') {
        const e = MATS.ebonite;
        part(c, cy, 0, 9 * mm, R * 0.84, R * 0.92, e, 3, angle, [R * 0.9, 0]);
        part(c, cy, 9 * mm, 1.4 * mm, R * 0.93, R * 0.93, MATS.gold, 1, angle);
        part(c, cy, 10.4 * mm, 63 * mm, R * 0.94, R * 0.95, MATS.greenStripes, 7, angle);
        part(c, cy, 73.4 * mm, 2 * mm, R * 0.96, R * 0.96, MATS.gold, 2, angle);
        if (open) {
          part(c, cy, 75.4 * mm, 21 * mm, R * 0.74, R * 0.6, e, 1, angle, [0, R * 0.25]);
          nib(c, cy, 94 * mm, 27 * mm, 3.8 * mm, 0.65 * mm, MATS.gold.color, inkRgb, mm, angle);
        } else {
          part(c, cy, 73 * mm, 52 * mm, R * 1.02, R * 0.92, e, 5, angle, [0, R * 0.9]);
        }
      } else {
        // Clear, colourless glass: mostly the felt through it, its edges and the twist's facets catching light.
        const glass: Mat = {
          color: [0.86, 0.9, 0.89],
          pattern: 3,
          patternScale: 14 * mm,
          gloss: 60,
          spec: 0.6,
          alpha: 0.14,
        };
        part(c, cy, 0, 112 * mm, R * 0.8, R, glass, 1, angle, [R * 0.8, 0]);
        part(c, cy, 112 * mm, 12 * mm, R, R * 0.78, glass, 2, angle);
        // The point: tighter twists, ink only in their grooves.
        const point: Mat = { ...glass, color2: inkRgb, patternScale: 3 * mm, alpha: 0.18 };
        part(c, cy, 124 * mm, 36 * mm, R * 0.78, 0.25 * mm, point, 3, angle);
      }
    });
  });
}

/**
 * The groove a pen lies in, in the felt tray (its rect is the pen's). `empty`: the pen is in use, so the
 * groove shows its faint, dust-free outline.
 */
export function recordPenGroove(key: PenKey, scale: number, empty: boolean): SkPicture {
  return cached(`groove:${key}:${q(scale)}:${empty}`, () => {
    const L = PENS[key].lengthMm * scale;
    const D = ITEM_MM.penDiameter[key] * scale;
    return record({ x: -8 * scale, y: -6 * scale, width: L + 16 * scale, height: D + 12 * scale }, (c) => {
      const gx = -3 * scale;
      const gw = L + 6 * scale;
      const gh = D * 0.9;
      const gy = (D - gh) / 2;
      const groove = rrectPath(gx, gy, gw, gh, gh / 2);
      c.drawPath(groove, fill(rgba(0.05, 0.08, 0.06, 0.16)));
      // The groove's upper wall shades it, its lower lip catches the light.
      c.save();
      c.clipPath(groove, ClipOp.Intersect, true);
      const sh = Skia.Paint();
      sh.setShader(
        Skia.Shader.MakeLinearGradient(
          { x: 0, y: gy },
          { x: 0, y: gy + gh },
          [rgba(0, 0, 0, 0.22), rgba(0, 0, 0, 0), rgba(1, 1, 1, 0.05)],
          [0, 0.55, 1],
          TileMode.Clamp,
        ),
      );
      c.drawRect(Skia.XYWHRect(gx, gy, gw, gh), sh);
      c.restore();
      if (empty) {
        // Where the pen lay, the felt kept clean: a faint, slightly deeper outline.
        const sil = rrectPath(0, D * 0.12, L, D * 0.76, D * 0.38);
        c.drawPath(sil, fill(rgba(0.03, 0.06, 0.05, 0.12)));
        c.drawPath(sil, stroke(rgba(0.9, 0.95, 0.9, 0.06), Math.max(0.5, 0.3 * scale)));
      }
    });
  });
}

// ---------------------------------------------------------------- ink

/** A small blob path round (cx, cy): irregular, seeded. */
function blob(rand: () => number, cx: number, cy: number, r: number, n = 12): SkPath {
  const b = Skia.PathBuilder.Make();
  for (let k = 0; k <= n; k++) {
    const t = ((k % n) / n) * Math.PI * 2;
    const rr = r * (0.78 + 0.4 * rand());
    if (k === 0) b.moveTo(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr);
    else b.lineTo(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr);
  }
  return b.close().detach();
}

/**
 * A square ink bottle (40 mm) seen from above: a long soft shadow with a caustic tinted by the ink; thin,
 * clear glass walls (the felt shows through them) with a bright refraction line on the lamp's side and a
 * dark one on the far side; the ink seen through the shoulder, darker toward the walls, with a lighter
 * meniscus ring round the neck; a flat, matte, knurled cap (a gentle tone across it toward the lamp, a lit
 * chamfer on that side, never a dome or a spot); a paper sticker on the shoulder with a dab of the ink and
 * a pencilled scrawl (no brand, no readable text).
 */
export function recordBottle(ink: InkKind, scale: number, seed = 0): SkPicture {
  return cached(`bottle:${ink}:${q(scale)}:${seed}`, () => {
    const mm = scale;
    const S = ITEM_MM.bottle * mm;
    const c0 = S / 2;
    const capR = 10.5 * mm;
    // In the bottle the ink is liquid: iron gall is still blue-grey (the sticker's dab is the dried colour).
    const inkC = liquidOf(ink);
    const dry = INKS[ink].rgb;
    const lx = LIGHT_DIR.x;
    const ly = LIGHT_DIR.y;
    const rand = mulberry32(subSeed(seed, `bottle:${ink}`));
    // Across the bottle toward the lamp (+) and away from it (−).
    const lit = { x: c0 + lx * S * 0.5, y: c0 + ly * S * 0.5 };
    const far = { x: c0 - lx * S * 0.5, y: c0 - ly * S * 0.5 };
    const linear = (stops: SkColor[], pos: number[] | null, from = lit, to = far) => {
      const p = Skia.Paint();
      p.setAntiAlias(true);
      p.setShader(Skia.Shader.MakeLinearGradient(from, to, stops, pos, TileMode.Clamp));
      return p;
    };
    return record({ x: -0.4 * S, y: -0.4 * S, width: 2 * S, height: 2 * S }, (c) => {
      const body = rrectPath(0, 0, S, S, 4.5 * mm);
      // A 55 mm tall object: a long shadow falling away from the lamp, softer as it goes.
      for (let i = 0; i < 6; i++) {
        const t = (i + 1) / 6;
        c.save();
        c.translate(-lx * t * 17 * mm, -ly * t * 17 * mm);
        c.drawPath(body, blurred(rgba(0.04, 0.025, 0.015, 0.1), (1.5 + t * 5) * mm));
        c.restore();
      }
      // Light through the glass and ink, focused in the shadow.
      const caus = Skia.Paint();
      caus.setBlendMode(BlendMode.Plus);
      const cx = c0 - lx * 22 * mm;
      const cy = c0 - ly * 22 * mm;
      caus.setShader(
        Skia.Shader.MakeRadialGradient(
          { x: cx, y: cy },
          8 * mm,
          [rgba(inkC[0] * 0.5 + 0.05, inkC[1] * 0.5 + 0.07, inkC[2] * 0.5 + 0.12, 0.35), rgba(0, 0, 0, 0)],
          null,
          TileMode.Clamp,
        ),
      );
      c.drawOval(Skia.XYWHRect(cx - 10 * mm, cy - 7 * mm, 20 * mm, 14 * mm), caus);
      // The glass wall: thin and clear, only faintly tinted over what lies under it.
      c.drawPath(body, fill(rgba(0.62, 0.68, 0.66, 0.22)));
      const wall = 1.5 * mm;
      const inner = Skia.RRectXY(Skia.XYWHRect(wall, wall, S - 2 * wall, S - 2 * wall), 3.4 * mm, 3.4 * mm);
      // The ink through the shoulder: lit toward the lamp, and darker toward the walls (deeper there).
      c.drawRRect(inner, linear([shade(inkC, 0.95), shade(inkC, 0.62), shade(inkC, 0.4)], [0, 0.5, 1]));
      const deep = Skia.Paint();
      deep.setAntiAlias(true);
      deep.setShader(
        Skia.Shader.MakeRadialGradient(
          { x: c0, y: c0 },
          (S / 2 - wall) * 1.25,
          [rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.08), rgba(0.01, 0.01, 0.02, 0.38)],
          [0, 0.55, 1],
          TileMode.Clamp,
        ),
      );
      c.drawRRect(inner, deep);
      // Refraction at the walls: a bright line on the lamp's side, a dark one on the far side, each fading
      // out round the corners (uneven, as thick glass bends the light).
      const outer = Skia.RRectXY(Skia.XYWHRect(0.35 * mm, 0.35 * mm, S - 0.7 * mm, S - 0.7 * mm), 4.2 * mm, 4.2 * mm);
      const brightLine = linear([rgba(1, 0.98, 0.93, 0.62), rgba(1, 0.98, 0.93, 0.18), rgba(1, 1, 1, 0)], [0, 0.3, 0.55]);
      brightLine.setStyle(PaintStyle.Stroke);
      brightLine.setStrokeWidth(Math.max(0.5, 0.55 * mm));
      c.drawRRect(outer, brightLine);
      const darkLine = linear([rgba(0, 0, 0, 0), rgba(0.03, 0.03, 0.04, 0.3), rgba(0.03, 0.03, 0.04, 0.6)], [0.45, 0.75, 1]);
      darkLine.setStyle(PaintStyle.Stroke);
      darkLine.setStrokeWidth(Math.max(0.5, 0.8 * mm));
      c.drawRRect(inner, darkLine);
      // The lamp in the shoulder: a soft streak along the lit corner, not a sharp window.
      c.save();
      c.translate(c0 + lx * S * 0.33, c0 + ly * S * 0.33);
      c.rotate(-32, 0, 0);
      c.drawRRect(
        Skia.RRectXY(Skia.XYWHRect(-6 * mm, -1 * mm, 12 * mm, 2 * mm), 1 * mm, 1 * mm),
        blurred(rgba(1, 0.97, 0.9, 0.22), 0.8 * mm),
      );
      c.restore();
      // The sticker on the shoulder, away from the cap: paper, a dab of the (dried) ink, a pencilled scrawl.
      c.save();
      c.translate(c0 + 7 * mm, c0 + 14.2 * mm);
      c.rotate(-6 + wobble(rand, 3), 0, 0);
      const tag = rrectPath(-5.5 * mm, -2.3 * mm, 11 * mm, 4.6 * mm, 0.4 * mm);
      c.drawPath(tag, blurred(rgba(0.05, 0.03, 0.02, 0.35), 0.4 * mm));
      c.drawPath(tag, fill(rgba(0.88, 0.84, 0.74, 1)));
      c.drawPath(blob(rand, -3.2 * mm, 0, 1.3 * mm), fill(rgba(dry[0], dry[1], dry[2], 0.92)));
      const scrawl = Skia.PathBuilder.Make().moveTo(-1.2 * mm, 0.3 * mm);
      for (let k = 1; k <= 7; k++)
        scrawl.lineTo(-1.2 * mm + k * 0.8 * mm, 0.3 * mm + (k % 2 ? -1 : 1) * (0.4 + 0.35 * rand()) * mm);
      const pencil = stroke(rgba(0.32, 0.3, 0.3, 0.7), Math.max(0.35, 0.22 * mm));
      pencil.setStrokeCap(StrokeCap.Round);
      c.drawPath(scrawl.detach(), pencil);
      c.restore();
      // The meniscus round the neck: the ink climbs the glass a little, lighter where it thins.
      c.drawCircle(
        c0,
        c0,
        capR + 0.7 * mm,
        stroke(
          rgba(Math.min(1, inkC[0] * 1.6 + 0.08), Math.min(1, inkC[1] * 1.6 + 0.08), Math.min(1, inkC[2] * 1.6 + 0.1), 0.5),
          Math.max(0.4, 0.5 * mm),
        ),
      );
      // The cap: matte and flat, its own shadow on the glass.
      c.drawCircle(c0 - lx * 2.2 * mm, c0 - ly * 2.2 * mm, capR, blurred(rgba(0, 0, 0, 0.45), 1.6 * mm));
      const capLit = { x: c0 + lx * capR, y: c0 + ly * capR };
      const capFar = { x: c0 - lx * capR, y: c0 - ly * capR };
      // Its knurled side: the ridges facing the lamp catch it (a crescent), the others stay dark.
      c.drawCircle(c0, c0, capR, fill(rgba(0.16, 0.15, 0.14, 1)));
      const knurl = stroke(rgba(0, 0, 0, 0), Math.max(0.4, 0.45 * mm));
      for (let k = 0; k < 60; k++) {
        const t = (k / 60) * Math.PI * 2;
        const facing = Math.cos(t) * lx + Math.sin(t) * ly;
        knurl.setColor(rgba(0.46, 0.43, 0.4, Math.max(0, facing) * 0.5 + 0.05));
        c.drawLine(
          c0 + Math.cos(t) * capR * 0.86,
          c0 + Math.sin(t) * capR * 0.86,
          c0 + Math.cos(t) * capR * 0.98,
          c0 + Math.sin(t) * capR * 0.98,
          knurl,
        );
      }
      // The flat top: a gentle tone across it (±7 % round a mid charcoal), no highlight spot.
      c.drawCircle(
        c0,
        c0,
        capR * 0.84,
        linear([Skia.Color('#3a3632'), Skia.Color('#34302d'), Skia.Color('#2e2b28')], [0, 0.5, 1], capLit, capFar),
      );
      // Its chamfer: lit on the lamp's side, in shade on the far side.
      const chamfer = linear(
        [rgba(0.62, 0.58, 0.54, 0.55), rgba(0.5, 0.47, 0.44, 0.08), rgba(0.03, 0.025, 0.02, 0.55)],
        [0, 0.5, 1],
        capLit,
        capFar,
      );
      chamfer.setStyle(PaintStyle.Stroke);
      chamfer.setStrokeWidth(Math.max(0.4, 0.35 * mm));
      c.drawCircle(c0, c0, capR * 0.84, chamfer);
    });
  });
}

/**
 * Where a bottle stood: a faint stain of its ink, never a clean outline. Two to four arcs of the bottle's
 * foot (40–70 % of it all told), of varying width and softly edged, a darker dried edge along parts of
 * them, a faint wash inside; the whole set a little off the slot and askew.
 */
export function recordInkRing(ink: InkKind, scale: number, seed: number): SkPicture {
  return cached(`ring:${ink}:${q(scale)}:${seed}`, () => {
    const mm = scale;
    const S = ITEM_MM.bottle * mm;
    const inkC = INKS[ink].rgb;
    const rand = mulberry32(subSeed(seed, `ring:${ink}`));
    // Dried ink on felt: a touch lighter and greyer than the ink, so it reads on the dark green.
    const stain = (a: number) => rgba(inkC[0] * 0.8 + 0.06, inkC[1] * 0.8 + 0.06, inkC[2] * 0.8 + 0.08, a);
    return record({ x: -4 * mm, y: -4 * mm, width: S + 8 * mm, height: S + 8 * mm }, (c) => {
      // The bottle's square foot (rounded corners), traced with a wandering seeded drift.
      const inset = 1.5 * mm;
      const side = S - 2 * inset;
      const n = 96;
      const pts: [number, number][] = [];
      let drift = 0;
      for (let k = 0; k < n; k++) {
        const t = (k / n) * Math.PI * 2;
        // A rounded square: a superellipse is near enough.
        const cx = Math.cos(t);
        const sy = Math.sin(t);
        const e = 0.25;
        const px = Math.sign(cx) * Math.pow(Math.abs(cx), e);
        const py = Math.sign(sy) * Math.pow(Math.abs(sy), e);
        drift += wobble(rand, 0.3 * mm);
        drift *= 0.92;
        const k2 = side / 2 - 0.9 * mm + drift;
        pts.push([side / 2 + px * k2, side / 2 + py * k2]);
      }
      const path = (from: number, to: number) => {
        const b = Skia.PathBuilder.Make().moveTo(pts[from % n][0], pts[from % n][1]);
        for (let k = from + 1; k <= to; k++) b.lineTo(pts[k % n][0], pts[k % n][1]);
        return b.detach();
      };
      // Not quite where the slot is: the bottle was put down a little off and askew.
      c.save();
      c.translate(inset + wobble(rand, 1 * mm), inset + wobble(rand, 1 * mm));
      c.rotate((rand() < 0.5 ? -1 : 1) * (1 + 2 * rand()), side / 2, side / 2);
      // A faint wash where the bottle stood.
      c.drawPath(rrectPath(0, 0, side, side, 5 * mm), fill(rgba(inkC[0] * 0.6, inkC[1] * 0.6, inkC[2] * 0.6, 0.05)));
      const arcs = 2 + Math.floor(rand() * 3);
      const total = Math.round(n * (0.4 + 0.3 * rand()));
      let k = Math.floor(rand() * n);
      for (let i = 0; i < arcs; i++) {
        const len = Math.max(6, Math.round((total / arcs) * (0.6 + 0.8 * rand())));
        const arc = path(k, k + len);
        const wide = stroke(stain(0.22 + 0.1 * rand()), (1 + 1.5 * rand()) * mm);
        wide.setStrokeCap(StrokeCap.Round);
        wide.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 0.4 * mm, true));
        c.drawPath(arc, wide);
        // The dried edge, darker, along part of the arc only.
        const from = k + Math.floor(rand() * len * 0.4);
        const to = Math.min(k + len, from + Math.round(len * (0.3 + 0.4 * rand())));
        const edge = stroke(stain(0.5), Math.max(0.5, 0.45 * mm));
        edge.setStrokeCap(StrokeCap.Round);
        edge.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 0.15 * mm, true));
        c.drawPath(path(from, to), edge);
        k += len + Math.round(((n - total) / arcs) * (0.5 + rand()));
      }
      c.restore();
    });
  });
}
