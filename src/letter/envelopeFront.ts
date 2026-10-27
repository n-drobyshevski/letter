import {
  BlendMode,
  BlurStyle,
  PaintStyle,
  Skia,
  TileMode,
  type SkCanvas,
  type SkFont,
  type SkPaint,
  type SkPicture,
  type SkRuntimeEffect,
  type SkTypeface,
} from '@shopify/react-native-skia';

import { mulberry32, range, subSeed } from '../lib/random';
import { INKS, PAPERS, POSTAL, type Country, type PaperKind } from '../theme/stationery';
import type { EnvelopeGeometry } from './envelope';
import { layoutHandwriting } from './handwriting';
import { measureWithFont, paperUniforms } from './renderLetter';
import { drawPostage, printFont } from './postage';
import { INK_SKSL, PAPER_SKSL } from './shaders';

/**
 * The address side of the envelope (landscape, envelope-local coordinates). From
 * Minsk: the printed Belarusian fields of a Belpochta envelope «Ад каго / Адкуль /
 * Каму / Куды» and the six index boxes, filled in by hand, the French address in
 * Latin letters; from France: no printed fields, the address as a block. The
 * postage of the sender's post office top-right (postage.ts), and the wear of a
 * trip through the post.
 */

export type Address = { fromName: string; fromCity: string; toName: string; toCity: string; toCountry?: string };
export type Postmark = { city: string; date: string /* YYYY-MM-DD */ };

export type FrontFonts = { hand: SkTypeface; print: SkTypeface; printBold: SkTypeface };

let effectsCache: { paper: SkRuntimeEffect; ink: SkRuntimeEffect } | null = null;
function effects() {
  if (!effectsCache) {
    const paper = Skia.RuntimeEffect.Make(PAPER_SKSL);
    const ink = Skia.RuntimeEffect.Make(INK_SKSL);
    if (!paper || !ink) throw new Error('Envelope front shaders failed to compile');
    effectsCache = { paper, ink };
  }
  return effectsCache;
}

const textWidth = (font: SkFont, s: string) => measureWithFont(font)(s);

function printedPaint(): SkPaint {
  const p = Skia.Paint();
  p.setColor(Skia.Color(POSTAL.printedFields));
  p.setAntiAlias(true);
  return p;
}

/** One handwritten line sitting on a printed rule. */
function handLine(c: SkCanvas, text: string, font: SkFont, x: number, baseline: number, maxW: number, seed: number, ink: SkPaint) {
  const layout = layoutHandwriting(text, measureWithFont(font), {
    seed,
    fontSize: font.getSize(),
    left: x,
    top: baseline,
    maxWidth: maxW,
    lineHeight: font.getSize() * 1.4,
    maxLines: 1,
  });
  for (const w of layout.words) {
    c.save();
    c.translate(w.x, w.y);
    c.rotate((w.rotation * 180) / Math.PI, 0, 0);
    c.scale(w.scale, w.scale);
    ink.setAlphaf(w.opacity);
    c.drawText(w.text, 0, 0, ink, font);
    c.restore();
  }
}

function field(c: SkCanvas, label: string, x: number, y: number, w: number, labelFont: SkFont) {
  const p = printedPaint();
  c.drawText(label, x, y, p, labelFont);
  const line = printedPaint();
  line.setStyle(PaintStyle.Stroke);
  line.setStrokeWidth(0.7);
  const lx = x + textWidth(labelFont, label) + 4;
  c.drawLine(lx, y + 1.5, x + w, y + 1.5, line);
  return lx;
}

/** Grime, a softened dog-eared corner: the envelope has been through sorting machines and a bag. */
function drawWear(c: SkCanvas, w: number, h: number, seed: number) {
  const rand = mulberry32(subSeed(seed, 'wear'));
  const vignette = Skia.Paint();
  vignette.setShader(
    Skia.Shader.MakeRadialGradient({ x: w / 2, y: h / 2 }, Math.hypot(w, h) * 0.55, [Skia.Color('rgba(60,40,20,0)'), Skia.Color('rgba(60,40,20,0.06)')], [0.6, 1], TileMode.Clamp),
  );
  c.drawRect(Skia.XYWHRect(0, 0, w, h), vignette);
  for (let i = 0; i < 3; i++) {
    const smudge = Skia.Paint();
    smudge.setColor(Skia.Color('rgba(70, 50, 30, 0.035)'));
    smudge.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, h * 0.06, true));
    c.drawCircle(range(rand, 0.1, 0.9) * w, range(rand, 0.15, 0.85) * h, h * range(rand, 0.06, 0.14), smudge);
  }
  // Dog-ear: bottom-left corner bent up a little.
  const d = h * range(rand, 0.06, 0.1);
  const crease = Skia.PathBuilder.Make().moveTo(0, h - d).lineTo(d * 0.95, h).detach();
  const shade = Skia.Paint();
  shade.setColor(Skia.Color('rgba(50, 30, 15, 0.09)'));
  c.drawPath(Skia.PathBuilder.Make().moveTo(0, h - d).lineTo(d * 0.95, h).lineTo(0, h).close().detach(), shade);
  const line = Skia.Paint();
  line.setStyle(PaintStyle.Stroke);
  line.setStrokeWidth(0.6);
  line.setColor(Skia.Color('rgba(50, 30, 15, 0.22)'));
  c.drawPath(crease, line);
}

export function recordEnvelopeFront(
  g: Pick<EnvelopeGeometry, 'width' | 'height'> & Partial<Pick<EnvelopeGeometry, 'unit' | 'format'>>,
  paper: PaperKind,
  seed: number,
  address: Address,
  postmark: Postmark,
  fonts: FrontFonts,
  options: { wear?: boolean; country?: Country } = {},
): SkPicture {
  const { width: w, height: h } = g;
  // Sizes of printed and written things come from the physical unit (a DL's height
  // at this scale), so they keep their real size on C5 and C6; on a DL it is exactly h.
  // Positions stay proportional to the envelope.
  const sized = g.format !== undefined && g.format !== 'DL' && g.unit !== undefined;
  const uh = sized ? g.unit! : h;
  const recorder = Skia.PictureRecorder();
  const c = recorder.beginRecording(Skia.XYWHRect(-10, -10, w + 20, h + 20));

  const base = Skia.Paint();
  base.setShader(effects().paper.makeShader(paperUniforms(PAPERS[paper], g, seed + 11, 0)));
  c.drawRect(Skia.XYWHRect(0, 0, w, h), base);

  const label = printFont(fonts.print, uh * 0.055);
  const hand = Skia.Font(fonts.hand, uh * 0.085);
  const ink = Skia.Paint();
  ink.setShader(effects().ink.makeShader([...INKS.blueBlack.rgb, seed % 997]));
  ink.setBlendMode(BlendMode.Multiply);
  ink.setAntiAlias(true);

  const country = options.country ?? 'by';
  if (country === 'by') {
    // Ад каго / Адкуль, top-left.
    const lx = w * 0.05;
    const lw = w * 0.42;
    const row = uh * 0.12;
    let y = h * 0.14;
    let x = field(c, 'Ад каго', lx, y, lw, label);
    handLine(c, address.fromName, hand, x + 2, y - 1, lx + lw - x, seed + 1, ink);
    y += row;
    x = field(c, 'Адкуль', lx, y, lw, label);
    handLine(c, address.fromCity, hand, x + 2, y - 1, lx + lw - x, seed + 2, ink);

    // Каму / Куды, bottom-right; abroad, the country goes on the last line, in Latin letters.
    const rx = w * 0.46;
    const rw = w * 0.5;
    y = h * 0.6;
    x = field(c, 'Каму', rx, y, rw, label);
    handLine(c, address.toName, hand, x + 2, y - 1, rx + rw - x, seed + 3, ink);
    y += row;
    x = field(c, 'Куды', rx, y, rw, label);
    handLine(c, address.toCity, hand, x + 2, y - 1, rx + rw - x, seed + 4, ink);
    y += row;
    x = field(c, '', rx, y, rw, label);
    if (address.toCountry) handLine(c, address.toCountry.toUpperCase(), hand, x + 2, y - 1, rx + rw - x, seed + 5, ink);

    // Індэкс месца прызначэння: the six-box template, bottom-left.
    const box = uh * 0.075;
    const ix = w * 0.05;
    const iy = h * 0.8;
    const frame = printedPaint();
    frame.setStyle(PaintStyle.Stroke);
    frame.setStrokeWidth(0.6);
    for (let i = 0; i < 6; i++) c.drawRect(Skia.XYWHRect(ix + i * box * 0.8, iy, box * 0.62, box), frame);
    c.drawText('Індэкс месца прызначэння', ix, iy - box * 0.3, printedPaint(), printFont(fonts.print, uh * 0.04));
  } else {
    // French envelopes have no printed fields: the sender small at the top left,
    // the address as a block at the bottom right, city in capitals, country last.
    const small = Skia.Font(fonts.hand, uh * 0.065);
    handLine(c, address.fromName, small, w * 0.05, h * 0.13, w * 0.4, seed + 1, ink);
    handLine(c, address.fromCity, small, w * 0.05, h * 0.13 + uh * 0.08, w * 0.4, seed + 2, ink);
    const bx = w * 0.5;
    const lines = [address.toName, address.toCity.toUpperCase(), (address.toCountry ?? '').toUpperCase()].filter(Boolean);
    lines.forEach((line, i) => handLine(c, line, hand, bx, h * 0.62 + i * uh * 0.12, w * 0.45, seed + 3 + i, ink));
  }

  // The sender's post office's postage, top-right, at its real size (a DL is 110 mm high).
  drawPostage(c, w, h, uh / 110, country, postmark, seed, fonts);

  if (options.wear) drawWear(c, w, h, seed);
  return recorder.finishRecordingAsPicture();
}
