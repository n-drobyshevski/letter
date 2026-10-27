import {
  BlendMode,
  BlurStyle,
  ClipOp,
  PaintStyle,
  TileMode,
  Skia,
  StrokeCap,
  StrokeJoin,
  type SkCanvas,
  type SkFont,
  type SkPaint,
  type SkPath,
  type SkPicture,
  type SkRuntimeEffect,
} from '@shopify/react-native-skia';

import { mulberry32, subSeed, wobble } from '../lib/random';
import { LINERS, PAPERS, type LinerKind, type PaperKind } from '../theme/stationery';
import { foldLines, type FoldKind } from './fold';
import { paperUniforms } from './renderLetter';
import { ENVELOPE_MM, FLAP_TIP, TIP_ROUND, tipFraction, type EnvelopeFormat } from './seal';
import { LINER_SKSL, PAPER_SKSL } from './shaders';

/**
 * A "wallet" envelope seen from the back (the flap side), DL proportions (2:1).
 * Everything is in envelope-local coordinates: (0, 0) is the top-left corner,
 * the flap hinges on y = 0 and, closed, points down to `flapTip`.
 */


// ISO 269 sizes (mm) per fold. They live in the pure seal.ts, which stores seals relative to them.
export { ENVELOPE_MM, type EnvelopeFormat };
export const ENVELOPE_FORMATS = Object.keys(ENVELOPE_MM) as EnvelopeFormat[];
export const formatForFold = (fold: FoldKind): EnvelopeFormat => (fold === 'half' ? 'C5' : fold === 'quarter' ? 'C6' : 'DL');

export type EnvelopeGeometry = {
  width: number;
  height: number;
  format: EnvelopeFormat;
  /**
   * Physical size unit: the height of a DL envelope (110 mm) at this envelope's
   * scale. Stamps, postmarks, writing and the wax seal are sized from it, so they
   * stay the same real size on every format.
   */
  unit: number;
  flapTip: number;
  /** The closed flap's tip (y = flapTip); x wobbles with the seed (seal.ts's tipFraction). */
  tip: { x: number; y: number };
  flap: SkPath;
  left: SkPath;
  right: SkPath;
  bottom: SkPath;
  /**
   * Legacy default placement: today's seal on the flap tip, overlapping the pocket. Stored
   * seals (letters.envelope.seal) go through seal.ts; defaultSeal reproduces this one.
   */
  seal: { x: number; y: number; maxR: number; stampR: number };
};

/** Triangle a → tip → b with the tip rounded off by `r` px. */
function roundedTriangle(a: [number, number], tip: [number, number], b: [number, number], r: number): SkPath {
  const toward = (p: [number, number]) => {
    const dx = tip[0] - p[0];
    const dy = tip[1] - p[1];
    const len = Math.hypot(dx, dy);
    const k = Math.max(0, (len - r) / len);
    return [p[0] + dx * k, p[1] + dy * k] as const;
  };
  const p1 = toward(a);
  const p2 = toward(b);
  return Skia.PathBuilder.Make()
    .moveTo(a[0], a[1])
    .lineTo(p1[0], p1[1])
    .quadTo(tip[0], tip[1], p2[0], p2[1])
    .lineTo(b[0], b[1])
    .close()
    .detach();
}

export function envelopeGeometry(width: number, seed: number, format: EnvelopeFormat = 'DL'): EnvelopeGeometry {
  const mm = ENVELOPE_MM[format];
  const height = Math.round((width * mm.h) / mm.w);
  const unit = format === 'DL' ? height : (width / mm.w) * 110;
  const rand = mulberry32(subSeed(seed, 'envelope'));
  // Hand-folded envelopes are never exactly symmetric (the tip's wobble is the first draw from the stream).
  const tipX = width * tipFraction(seed, rand);
  const flapTip = height * FLAP_TIP;
  const maxR = unit * 0.17;
  return {
    width,
    height,
    format,
    unit,
    flapTip,
    tip: { x: tipX, y: flapTip },
    flap: roundedTriangle([0, 0], [tipX, flapTip], [width, 0], height * TIP_ROUND),
    // Side flaps stay above the closing flap's edges, so a closed envelope shows no gap.
    left: roundedTriangle([0, 0], [width * 0.45, height * 0.42], [0, height], height * 0.1),
    right: roundedTriangle([width, 0], [width * 0.55, height * 0.42], [width, height], height * 0.1),
    // Steeper than the side flaps' lower edges, so the flaps overlap with no gap between them.
    bottom: roundedTriangle([0, height], [width / 2 + wobble(rand, width * 0.004), height * 0.3], [width, height], height * 0.24),
    seal: { x: tipX, y: flapTip - maxR * 0.2, maxR, stampR: maxR * 0.72 },
  };
}

let paperEffect: SkRuntimeEffect | null = null;
let linerEffect: SkRuntimeEffect | null = null;

function effects() {
  paperEffect ??= Skia.RuntimeEffect.Make(PAPER_SKSL);
  linerEffect ??= Skia.RuntimeEffect.Make(LINER_SKSL);
  if (!paperEffect || !linerEffect) throw new Error('Envelope shaders failed to compile');
  return { paper: paperEffect, liner: linerEffect };
}

function paperPaint(kind: PaperKind, g: EnvelopeGeometry, seed: number): SkPaint {
  const paint = Skia.Paint();
  paint.setShader(effects().paper.makeShader(paperUniforms(PAPERS[kind], g, seed, 0)));
  return paint;
}

function linerPaint(kind: LinerKind, seed: number, shade: number): SkPaint {
  const l = LINERS[kind];
  const paint = Skia.Paint();
  paint.setShader(effects().liner.makeShader([seed % 997, ...l.base, ...l.pattern, l.scale, shade]));
  return paint;
}

const SHADOW = Skia.Color('rgba(40, 24, 10, 0.22)');

function withShadow(paint: SkPaint, dx: number, dy: number, sigma: number, color = SHADOW): SkPaint {
  const p = paint.copy();
  p.setImageFilter(Skia.ImageFilter.MakeDropShadow(dx, dy, sigma, sigma, color, null));
  return p;
}

/** Tint a flap a touch lighter or darker: paper never lies perfectly flat under one lamp. */
function tint(canvas: SkCanvas, path: SkPath, amount: number) {
  const p = Skia.Paint();
  p.setColor(Skia.Color(amount > 0 ? `rgba(255, 250, 240, ${amount})` : `rgba(30, 18, 8, ${-amount})`));
  canvas.drawPath(path, p);
}

function record(width: number, top: number, height: number, draw: (canvas: SkCanvas) => void): SkPicture {
  const recorder = Skia.PictureRecorder();
  draw(recorder.beginRecording(Skia.XYWHRect(-20, top - 20, width + 40, height + 40)));
  return recorder.finishRecordingAsPicture();
}

export type EnvelopeParts = {
  /** The far wall (inside of the address side), seen through the open pocket. */
  interior: SkPicture;
  /** Side and bottom flaps: the pocket the letter slides behind. */
  pocket: SkPicture;
  /** Closing flap, outside (visible once closed). */
  flapOuter: SkPicture;
  /** Closing flap, inside: liner pattern and the gum strip (visible while open). */
  flapInner: SkPicture;
};

export function recordEnvelope(g: EnvelopeGeometry, paper: PaperKind, liner: LinerKind, seed: number): EnvelopeParts {
  const { width: w, height: h } = g;
  const rect = Skia.XYWHRect(0, 0, w, h);

  const interior = record(w, 0, h, (c) => {
    c.drawRect(rect, linerPaint(liner, seed, 0.66));
    // Deeper inside the pocket is darker.
    const shade = Skia.Paint();
    shade.setShader(
      Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: 0, y: h }, [Skia.Color('rgba(20,10,4,0)'), Skia.Color('rgba(20,10,4,0.35)')], null, TileMode.Clamp),
    );
    c.drawRect(rect, shade);
  });

  const pocket = record(w, 0, h, (c) => {
    c.drawPath(g.left, withShadow(paperPaint(paper, g, seed + 1), 0.8, 0.6, 1.3));
    tint(c, g.left, 0.03);
    c.drawPath(g.right, withShadow(paperPaint(paper, g, seed + 2), -0.6, 0.6, 1.3));
    tint(c, g.right, -0.03);
    c.drawPath(g.bottom, withShadow(paperPaint(paper, g, seed + 3), 0, -0.9, 1.6));
    tint(c, g.bottom, -0.015);
    // The folded-over outer edges catch a little shadow.
    const edge = Skia.Paint();
    edge.setStyle(PaintStyle.Stroke);
    edge.setStrokeWidth(1.2);
    edge.setColor(Skia.Color('rgba(40, 24, 10, 0.12)'));
    c.drawRect(Skia.XYWHRect(0.6, 0.6, w - 1.2, h - 1.2), edge);
  });

  const flapOuter = record(w, 0, h, (c) => {
    c.drawPath(g.flap, withShadow(paperPaint(paper, g, seed + 4), 0.8, 2, 2, Skia.Color('rgba(40, 24, 10, 0.3)')));
    tint(c, g.flap, 0.02);
  });

  const flapInner = record(w, 0, h, (c) => {
    c.drawPath(g.flap, linerPaint(liner, seed + 5, 0.92));
    // Gum strip along both slanted edges: slightly darker, faintly glossy.
    c.save();
    c.clipPath(g.flap, ClipOp.Intersect, true);
    const gum = Skia.Paint();
    gum.setStyle(PaintStyle.Stroke);
    gum.setStrokeWidth(h * 0.11);
    gum.setStrokeJoin(StrokeJoin.Round);
    gum.setStrokeCap(StrokeCap.Round);
    gum.setBlendMode(BlendMode.Multiply);
    gum.setColor(Skia.Color('rgba(196, 170, 120, 0.45)'));
    const edges = Skia.PathBuilder.Make()
      .moveTo(0, 0)
      .lineTo(g.tip.x, g.flapTip)
      .lineTo(w, 0)
      .detach();
    c.drawPath(edges, gum);
    c.restore();
  });

  return { interior, pocket, flapOuter, flapInner };
}

/**
 * The folded letter as seen from outside: the back of the last panel folded on
 * top, a little of its own writing showing through (mirrored by the fold), the
 * edges of the hidden panels pressing through as faint lines.
 *   tri      the back of the top third over the middle third (DL)
 *   half     the back of the top half over the bottom half (A5)
 *   quarter  the back of the bottom-right quarter over the bottom-left (A6),
 *            turned sideways: that is how an A6 goes into a C6
 */
export function recordFoldedLetter(
  front: SkPicture,
  back: SkPicture,
  sheet: { width: number; height: number },
  seed: number,
  kind: FoldKind = 'tri',
): { picture: SkPicture; width: number; height: number } {
  const { width: W, height: H } = sheet;
  const lines = foldLines(kind, W, H, seed);
  // The stack's rectangle on the sheet, and the panel lying on top of it.
  const [a, b] = kind === 'tri' ? lines.ys : [lines.ys[0], H];
  const x = lines.x ?? W;
  const stackW = x;
  const stackH = b - a;
  const recorder = Skia.PictureRecorder();
  const c = recorder.beginRecording(Skia.XYWHRect(-10, -10, stackW + 20, stackH + 20));

  // Soft shadow of the whole stack.
  const shadow = Skia.Paint();
  shadow.setColor(Skia.Color('rgba(30, 18, 8, 0.3)'));
  shadow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 2.5, true));
  c.drawRect(Skia.XYWHRect(1, 2, stackW, stackH), shadow);

  c.save();
  c.clipRect(Skia.XYWHRect(0, 0, stackW, stackH), ClipOp.Intersect, true);
  c.translate(0, -a);
  c.drawPicture(back);
  c.restore();

  // Through paper, writing is faint and diffuse, never crisp.
  const ghost = Skia.Paint();
  ghost.setAlphaf(0.045);
  ghost.setImageFilter(Skia.ImageFilter.MakeBlur(0.9, 0.9, TileMode.Decal, null));
  const line = Skia.Paint();
  line.setStyle(PaintStyle.Stroke);
  line.setStrokeWidth(1);

  if (kind === 'quarter') {
    // The right quarter's own writing, mirrored about the vertical crease.
    c.save();
    c.clipRect(Skia.XYWHRect(Math.max(0, 2 * x - W), 0, stackW, stackH), ClipOp.Intersect, true);
    c.saveLayer(ghost);
    c.translate(2 * x, -a);
    c.scale(-1, 1);
    c.drawPicture(front);
    c.restore();
    c.restore();
    // Its outer edge, if it falls short of the fold's far side.
    if (2 * x - W > 1) {
      line.setColor(Skia.Color('rgba(30, 18, 8, 0.16)'));
      c.drawLine(2 * x - W + 0.5, 0, 2 * x - W + 0.5, stackH, line);
    }
    const upright = recorder.finishRecordingAsPicture();
    const turned = Skia.PictureRecorder();
    const t = turned.beginRecording(Skia.XYWHRect(-10, -10, stackH + 20, stackW + 20));
    t.translate(stackH, 0);
    t.rotate(90, 0, 0);
    t.drawPicture(upright);
    return { picture: turned.finishRecordingAsPicture(), width: stackH, height: stackW };
  }

  // Show-through of the top panel's own writing, mirrored about its crease.
  c.save();
  c.clipRect(Skia.XYWHRect(0, 0, W, Math.min(a, stackH)), ClipOp.Intersect, true);
  c.saveLayer(ghost);
  c.translate(0, a);
  c.scale(1, -1);
  c.drawPicture(front);
  c.restore();
  c.restore();

  // Edge of the top panel (if shorter than the stack) and of the bottom panel beneath it.
  if (a < stackH - 1) {
    line.setColor(Skia.Color('rgba(30, 18, 8, 0.16)'));
    c.drawLine(0, a + 0.5, W, a + 0.5, line);
  }
  const hidden = 2 * b - H - a;
  if (kind === 'tri' && hidden > 1 && hidden < stackH - 1) {
    line.setColor(Skia.Color('rgba(30, 18, 8, 0.06)'));
    c.drawLine(0, hidden, W, hidden, line);
  }
  return { picture: recorder.finishRecordingAsPicture(), width: stackW, height: stackH };
}

/** Initials + a ring, as alpha: what the brass stamp leaves raised in the wax. */
export function recordMonogram(initials: string, font: SkFont, size: number): SkPicture {
  const recorder = Skia.PictureRecorder();
  const c = recorder.beginRecording(Skia.XYWHRect(0, 0, size, size));
  const soft = Skia.MaskFilter.MakeBlur(BlurStyle.Normal, size * 0.008, true);
  const fill = Skia.Paint();
  fill.setColor(Skia.Color('white'));
  fill.setMaskFilter(soft);
  const ids = font.getGlyphIDs(initials);
  const textW = font.getGlyphWidths(ids).reduce((s, x) => s + x, 0);
  const m = font.getMetrics();
  c.drawText(initials, (size - textW) / 2, size / 2 - (m.ascent + m.descent) / 2, fill, font);
  const ring = Skia.Paint();
  ring.setColor(Skia.Color('white'));
  ring.setStyle(PaintStyle.Stroke);
  ring.setStrokeWidth(size * 0.022);
  ring.setMaskFilter(soft);
  c.drawCircle(size / 2, size / 2, size * 0.42, ring);
  return recorder.finishRecordingAsPicture();
}

