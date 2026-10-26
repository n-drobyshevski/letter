import {
  BlendMode,
  BlurStyle,
  ClipOp,
  PaintStyle,
  Skia,
  StrokeCap,
  TileMode,
  type SkCanvas,
  type SkFont,
  type SkPaint,
  type SkPicture,
  type SkRuntimeEffect,
  type SkTypeface,
} from '@shopify/react-native-skia';

import { mulberry32, range, subSeed, wobble } from '../lib/random';
import { INKS, PAPERS, POSTAL, type Country, type PaperKind } from '../theme/stationery';
import type { EnvelopeGeometry } from './envelope';
import { layoutHandwriting } from './handwriting';
import { measureWithFont, paperUniforms } from './renderLetter';
import { INK_SKSL, PAPER_SKSL, STAMP_INK_SKSL } from './shaders';

/**
 * The address side of the envelope (landscape, envelope-local coordinates):
 * printed Russian fields «От кого / Откуда / Кому / Куда» filled in by hand,
 * a perforated stamp top-right, the calendar postmark with the real city and
 * date, machine cancellation waves, and the wear of a trip through the post.
 */

export type Address = { fromName: string; fromCity: string; toName: string; toCity: string; toCountry?: string };
export type Postmark = { city: string; date: string /* YYYY-MM-DD */ };

export type FrontFonts = { hand: SkTypeface; print: SkTypeface; printBold: SkTypeface };

let effectsCache: { paper: SkRuntimeEffect; ink: SkRuntimeEffect; stamp: SkRuntimeEffect } | null = null;
function effects() {
  if (!effectsCache) {
    const paper = Skia.RuntimeEffect.Make(PAPER_SKSL);
    const ink = Skia.RuntimeEffect.Make(INK_SKSL);
    const stamp = Skia.RuntimeEffect.Make(STAMP_INK_SKSL);
    if (!paper || !ink || !stamp) throw new Error('Envelope front shaders failed to compile');
    effectsCache = { paper, ink, stamp };
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

/** Text set along a circle (postmark rims): `top` reads clockwise over the top, else under the bottom. */
function arcText(c: SkCanvas, text: string, font: SkFont, cx: number, cy: number, r: number, top: boolean, paint: SkPaint) {
  const ids = font.getGlyphIDs(text);
  const widths = font.getGlyphWidths(ids);
  const total = widths.reduce((s, x) => s + x, 0) + (text.length - 1) * font.getSize() * 0.12;
  let angle = (top ? -Math.PI / 2 : Math.PI / 2) + (top ? -1 : 1) * (total / r) / 2;
  const chars = [...text];
  chars.forEach((ch, i) => {
    const adv = widths[i] + font.getSize() * 0.12;
    const mid = angle + ((top ? 1 : -1) * (widths[i] / 2)) / r;
    c.save();
    c.translate(cx + r * Math.cos(mid), cy + r * Math.sin(mid));
    c.rotate(((mid + (top ? Math.PI / 2 : -Math.PI / 2)) * 180) / Math.PI, 0, 0);
    c.drawText(ch, -widths[i] / 2, top ? 0 : font.getSize() * 0.7, paint, font);
    c.restore();
    angle += ((top ? 1 : -1) * adv) / r;
  });
}

function drawStamp(c: SkCanvas, x: number, y: number, w: number, h: number, seed: number, fonts: FrontFonts, country: Country) {
  const rand = mulberry32(subSeed(seed, 'stamp'));
  const palette = POSTAL.stampPalettes[Math.floor(rand() * POSTAL.stampPalettes.length)];
  const tilt = wobble(rand, 2.2);
  c.save();
  c.rotate(tilt, x + w / 2, y + h / 2);

  // Perforations: the stamp edge is a row of half-holes.
  const hole = w * 0.045;
  const holes = Skia.PathBuilder.Make();
  const along = (len: number) => Math.max(3, Math.round(len / (hole * 2.6)));
  for (let i = 0; i <= along(w); i++) {
    const px = x + (w * i) / along(w);
    holes.addCircle(px, y, hole).addCircle(px, y + h, hole);
  }
  for (let i = 0; i <= along(h); i++) {
    const py = y + (h * i) / along(h);
    holes.addCircle(x, py, hole).addCircle(x + w, py, hole);
  }
  c.save();
  c.clipPath(holes.detach(), ClipOp.Difference, true);
  const paper = Skia.Paint();
  paper.setColor(Skia.Color(POSTAL.stampPaper));
  paper.setImageFilter(Skia.ImageFilter.MakeDropShadow(0.4, 0.8, 0.8, 0.8, Skia.Color('rgba(40,24,10,0.25)'), null));
  c.drawRect(Skia.XYWHRect(x, y, w, h), paper);
  c.restore();

  // The picture: a quiet landscape in offset-print colours.
  const m = w * 0.1;
  const ix = x + m;
  const iy = y + m;
  const iw = w - 2 * m;
  const ih = h - 2 * m;
  c.save();
  c.clipRect(Skia.XYWHRect(ix, iy, iw, ih), ClipOp.Intersect, true);
  const sky = Skia.Paint();
  sky.setShader(
    Skia.Shader.MakeLinearGradient({ x: ix, y: iy }, { x: ix, y: iy + ih }, [Skia.Color(palette[0]), Skia.Color(palette[1])], null, TileMode.Clamp),
  );
  c.drawRect(Skia.XYWHRect(ix, iy, iw, ih), sky);
  const sun = Skia.Paint();
  sun.setColor(Skia.Color(palette[2]));
  c.drawCircle(ix + iw * range(rand, 0.25, 0.75), iy + ih * 0.42, iw * 0.16, sun);
  const hill = (base: number, amp: number, color: string) => {
    const p = Skia.Paint();
    p.setColor(Skia.Color(color));
    const path = Skia.PathBuilder.Make().moveTo(ix, iy + ih);
    for (let k = 0; k <= 8; k++) path.lineTo(ix + (iw * k) / 8, iy + ih * base - amp * Math.sin(k * 0.9 + rand() * 2));
    c.drawPath(path.lineTo(ix + iw, iy + ih).close().detach(), p);
  };
  hill(0.68, ih * 0.06, palette[3]);
  hill(0.8, ih * 0.04, '#00000055');
  c.restore();

  const label = Skia.Paint();
  label.setColor(Skia.Color('rgba(20, 20, 30, 0.85)'));
  const small = Skia.Font(fonts.printBold, h * 0.09);
  // RU stamps carry «РОССИЯ» and a value; French international stamps say RF and MONDE, no value.
  c.drawText(country === 'fr' ? 'RF' : 'РОССИЯ', ix + 1, iy + h * 0.09, label, small);
  const value = Skia.Font(fonts.printBold, h * (country === 'fr' ? 0.1 : 0.13));
  const val = country === 'fr' ? 'MONDE' : '45,00';
  c.drawText(val, ix + iw - textWidth(value, val) - 1, iy + ih - 2, label, value);
  const year = Skia.Font(fonts.print, h * 0.07);
  c.drawText('2026', ix + 1, iy + ih - 2, label, year);
  c.restore();
}

function drawPostmark(c: SkCanvas, cx: number, cy: number, r: number, pm: Postmark, seed: number, fonts: FrontFonts, country: Country) {
  const rand = mulberry32(subSeed(seed, 'postmark'));
  const rot = wobble(rand, 8);
  const tiltAngle = rand() * Math.PI * 2;
  const ink = Skia.Paint();
  ink.setShader(
    effects().stamp.makeShader([...POSTAL.postmarkInk, seed % 89, cx, cy, Math.cos(tiltAngle), Math.sin(tiltAngle), r]),
  );
  // Normal blending: postmark ink lies on top of the stamp's dark colours (multiply would vanish there).
  ink.setAntiAlias(true);

  c.save();
  c.rotate(rot, cx, cy);
  const ring = ink.copy();
  ring.setStyle(PaintStyle.Stroke);
  ring.setStrokeWidth(r * 0.05);
  c.drawCircle(cx, cy, r, ring);
  const inner = ring.copy();
  inner.setStrokeWidth(r * 0.035);
  c.drawCircle(cx, cy, r * 0.66, inner);

  const rimFont = Skia.Font(fonts.printBold, r * 0.24);
  arcText(c, pm.city.toUpperCase(), rimFont, cx, cy, r * 0.76, true, ink);
  arcText(c, country === 'fr' ? 'FRANCE' : 'ПОЧТА', rimFont, cx, cy, r * 0.76, false, ink);

  const [yy, mm, dd] = pm.date.split('-');
  const date = country === 'fr' ? `${dd}-${mm} ${yy.slice(2)}` : `${dd}.${mm}.${yy.slice(2)}`;
  const dateFont = Skia.Font(fonts.printBold, r * 0.3);
  const bar = ring.copy();
  bar.setStrokeWidth(r * 0.03);
  c.drawLine(cx - r * 0.6, cy - r * 0.2, cx + r * 0.6, cy - r * 0.2, bar);
  c.drawLine(cx - r * 0.6, cy + r * 0.22, cx + r * 0.6, cy + r * 0.22, bar);
  c.drawText(date, cx - textWidth(dateFont, date) / 2, cy + r * 0.11, ink, dateFont);
  c.restore();
}

/** Machine cancellation: a band of wavy lines running off to the left of the postmark. */
function drawCancellation(c: SkCanvas, x0: number, x1: number, cy: number, r: number, seed: number) {
  const rand = mulberry32(subSeed(seed, 'waves'));
  const ink = Skia.Paint();
  ink.setShader(effects().stamp.makeShader([...POSTAL.postmarkInk, (seed % 83) + 5, (x0 + x1) / 2, cy, 1, 0.2, (x1 - x0) / 2]));
  ink.setStyle(PaintStyle.Stroke);
  ink.setStrokeWidth(r * 0.05);
  ink.setStrokeCap(StrokeCap.Round);
  ink.setAntiAlias(true);
  const phase = rand() * Math.PI * 2;
  for (let i = 0; i < 5; i++) {
    const y = cy - r * 0.7 + (i * r * 1.4) / 4;
    const path = Skia.PathBuilder.Make().moveTo(x0, y);
    for (let x = x0; x <= x1; x += 2) path.lineTo(x, y + Math.sin((x - x0) / (r * 0.32) + phase) * r * 0.1);
    c.drawPath(path.detach(), ink);
  }
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
  // and width at this scale), so they keep their real size on C5 and C6; on a DL
  // these are exactly h and w. Positions stay proportional to the envelope.
  const sized = g.format !== undefined && g.format !== 'DL' && g.unit !== undefined;
  const uh = sized ? g.unit! : h;
  const uw = sized ? g.unit! * 2 : w;
  const recorder = Skia.PictureRecorder();
  const c = recorder.beginRecording(Skia.XYWHRect(-10, -10, w + 20, h + 20));

  const base = Skia.Paint();
  base.setShader(effects().paper.makeShader(paperUniforms(PAPERS[paper], g, seed + 11, 0)));
  c.drawRect(Skia.XYWHRect(0, 0, w, h), base);

  const label = Skia.Font(fonts.print, uh * 0.055);
  const hand = Skia.Font(fonts.hand, uh * 0.085);
  const ink = Skia.Paint();
  ink.setShader(effects().ink.makeShader([...INKS.blueBlack.rgb, seed % 997]));
  ink.setBlendMode(BlendMode.Multiply);
  ink.setAntiAlias(true);

  const country = options.country ?? 'ru';
  if (country === 'ru') {
    // От кого / Откуда, top-left.
    const lx = w * 0.05;
    const lw = w * 0.42;
    const row = uh * 0.12;
    let y = h * 0.14;
    let x = field(c, 'От кого', lx, y, lw, label);
    handLine(c, address.fromName, hand, x + 2, y - 1, lx + lw - x, seed + 1, ink);
    y += row;
    x = field(c, 'Откуда', lx, y, lw, label);
    handLine(c, address.fromCity, hand, x + 2, y - 1, lx + lw - x, seed + 2, ink);

    // Кому / Куда, bottom-right.
    const rx = w * 0.46;
    const rw = w * 0.5;
    y = h * 0.6;
    x = field(c, 'Кому', rx, y, rw, label);
    handLine(c, address.toName, hand, x + 2, y - 1, rx + rw - x, seed + 3, ink);
    y += row;
    x = field(c, 'Куда', rx, y, rw, label);
    handLine(c, address.toCity, hand, x + 2, y - 1, rx + rw - x, seed + 4, ink);
    y += row;
    field(c, '', rx, y, rw, label);

    // Индекс места назначения: the six-box template, bottom-left.
    const box = uh * 0.075;
    const ix = w * 0.05;
    const iy = h * 0.8;
    const frame = printedPaint();
    frame.setStyle(PaintStyle.Stroke);
    frame.setStrokeWidth(0.6);
    for (let i = 0; i < 6; i++) c.drawRect(Skia.XYWHRect(ix + i * box * 0.8, iy, box * 0.62, box), frame);
    c.drawText('Индекс места назначения', ix, iy - box * 0.3, printedPaint(), Skia.Font(fonts.print, uh * 0.04));
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

  // Stamp and postmark, top-right.
  const sw = uw * 0.13;
  const sh = uh * 0.34;
  const sx = w - sw - uw * 0.04;
  const sy = uh * 0.07;
  drawStamp(c, sx, sy, sw, sh, seed, fonts, country);
  const r = uh * 0.13;
  const pcx = sx - r * 0.15;
  const pcy = sy + sh * 0.72;
  drawCancellation(c, sx - r * 4.2, sx - r * 1.05, pcy, r, seed);
  drawPostmark(c, pcx, pcy, r, postmark, seed, fonts, country);

  if (options.wear) drawWear(c, w, h, seed);
  return recorder.finishRecordingAsPicture();
}

/** A hairline crack across a seal that travelled through the post. Drawn over the wax. */
export function sealCrackPath(cx: number, cy: number, r: number, seed: number) {
  const rand = mulberry32(subSeed(seed, 'crack'));
  const a = rand() * Math.PI;
  const path = Skia.PathBuilder.Make();
  const start = [cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95] as const;
  path.moveTo(start[0], start[1]);
  let px = start[0];
  let py = start[1];
  const steps = 7;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const tx = cx + Math.cos(a) * r * 0.95 * (1 - 2 * t);
    const ty = cy + Math.sin(a) * r * 0.95 * (1 - 2 * t);
    px = tx + wobble(rand, r * 0.08);
    py = ty + wobble(rand, r * 0.08);
    path.lineTo(px, py);
  }
  return path.detach();
}
