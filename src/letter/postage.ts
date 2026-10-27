import { ClipOp, FontHinting, PaintStyle, Skia, StrokeCap, TileMode, type SkCanvas, type SkFont, type SkPaint, type SkTypeface } from '@shopify/react-native-skia';

import { mulberry32, range, subSeed, wobble } from '../lib/random';
import { POSTAL, type Country } from '../theme/stationery';
import { measureWithFont } from './renderLetter';
import { STAMP_INK_SKSL } from './shaders';

/**
 * The postage on the address side, as each post office really does it (late 2026),
 * drawn from scratch: no copied artwork, no logos; the printed words are the real ones.
 *
 * From Minsk (Belpochta): one self-adhesive definitive of the «Дикая природа Беларусі»
 * kind, 18 × 26 mm, straight cut, the rate letter «Р» (priority letter abroad, up to
 * 20 g), our own drawing of a Norway spruce on a pale ground; the blue priority label;
 * the round calendar postmark struck by hand in violet ink, «БЕЛАРУСЬ» over the top,
 * the office «МИНСК-50» under the bottom, the date «22 10 26» between two bars.
 *
 * From France (La Poste): one «Lettre internationale» stamp, violet, landscape
 * 40 × 26 mm, perforated, «FRANCE», «International», «La Poste» up the side, a profile
 * before a globe (our own) and a DataMatrix; the sorting machine's black inkjet
 * postmark, no town, just «LA POSTE 59368A» (the centre's code) over «FRANCE 22-10-26»,
 * its wavy lines running across the stamp.
 *
 * Sizes are in millimetres of the envelope (`mm` px each), so a C5 or C6 carries the
 * same stamps at the same size as a DL.
 */

export type PostageFonts = { print: SkTypeface; printBold: SkTypeface };
export type PostageMark = { city: string; date: string /* YYYY-MM-DD */ };

let stampInk: ReturnType<typeof Skia.RuntimeEffect.Make> = null;
const inkEffect = () => {
  stampInk ??= Skia.RuntimeEffect.Make(STAMP_INK_SKSL);
  if (!stampInk) throw new Error('Stamp ink shader failed to compile');
  return stampInk;
};

const textWidth = (font: SkFont, s: string) => measureWithFont(font)(s);

/**
 * Print a few px high (the envelope is recorded small and scaled up): unhinted, with
 * linear metrics, or hinting rounds a space's advance down to nothing.
 */
export function printFont(face: SkTypeface, size: number): SkFont {
  const font = Skia.Font(face, size);
  font.setHinting(FontHinting.None);
  font.setLinearMetrics(true);
  font.setSubpixel(true);
  return font;
}

const fill = (color: string) => {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(Skia.Color(color));
  return p;
};
const stroke = (color: string, width: number) => {
  const p = fill(color);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(width);
  return p;
};

/** Text set along a circle (postmark rims): `top` reads clockwise over the top, else under the bottom. */
export function arcText(c: SkCanvas, text: string, font: SkFont, cx: number, cy: number, r: number, top: boolean, paint: SkPaint) {
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

/** The post office in a Belarusian calendar postmark: Minsk's main office is МИНСК-50 (220050). */
export function byOffice(city: string): string {
  const c = city.trim();
  if (/^(minsk|минск|мінск)/i.test(c)) return 'МИНСК-50';
  return c.toUpperCase();
}

/** The sorting centre's code in a French machine postmark: the département, three digits, A. */
export function rocCode(city: string, seed: number): string {
  const c = city.trim().toLowerCase();
  const dept = /lille|lesquin|roubaix|tourcoing|villeneuve/.test(c) ? '59' : /lyon/.test(c) ? '69' : /marseille/.test(c) ? '13' : '75';
  return `${dept}${100 + (Math.abs(seed) % 900)}A`;
}

const dateParts = (date: string) => {
  const [yy = '2026', mo = '01', dd = '01'] = date.split('-');
  return { dd, mo, yy: yy.slice(2) };
};

/** A sheet of postage paper, lying a hair proud of the envelope. */
function stampPaper(c: SkCanvas, x: number, y: number, w: number, h: number, mm: number, color: string) {
  const paper = fill(color);
  paper.setImageFilter(Skia.ImageFilter.MakeDropShadow(0.15 * mm, 0.3 * mm, 0.3 * mm, 0.3 * mm, Skia.Color('rgba(40,24,10,0.28)'), null));
  c.drawRect(Skia.XYWHRect(x, y, w, h), paper);
}

// ───────────────────────── Belarus ─────────────────────────

/** Our drawing of a Norway spruce, natural-history style: tiers of drooping boughs, a few cones. */
function drawSpruce(c: SkCanvas, cx: number, top: number, base: number, halfMax: number, mm: number, rand: () => number) {
  // Its shadow on the ground, and the ground.
  const ground = fill('rgba(70, 90, 50, 0.22)');
  c.drawOval(Skia.XYWHRect(cx - halfMax * 0.8, base - 0.5 * mm, halfMax * 1.6, 1 * mm), ground);
  const trunk = fill('#6a4a33');
  c.drawRect(Skia.XYWHRect(cx - 0.35 * mm, base - 3.2 * mm, 0.7 * mm, 3.2 * mm), trunk);

  const tiers = 9;
  const bottom = base - 2.2 * mm;
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const yk = top + (bottom - top) * t;
    const half = (0.7 + (halfMax / mm - 0.7) * Math.pow(t, 0.9)) * mm;
    const droop = (0.9 + 1.6 * t) * mm;
    // The bough: from the stem, out and down to two tips, the lower edge a fringe of needle tufts.
    const path = Skia.PathBuilder.Make().moveTo(cx, yk - 0.9 * mm);
    path.quadTo(cx - half * 0.55, yk + droop * 0.15, cx - half, yk + droop);
    const tufts = 5 + Math.round(t * 4);
    for (let i = 1; i <= tufts * 2; i++) {
      const u = i / (tufts * 2);
      const px = cx - half + u * half * 2;
      const sag = droop * (0.55 + 0.45 * Math.abs(1 - 2 * u));
      path.lineTo(px, yk + sag + (i % 2 ? -0.55 : 0.15) * mm);
    }
    path.quadTo(cx + half * 0.55, yk + droop * 0.15, cx, yk - 0.9 * mm).close();
    const bough = path.detach();
    c.drawPath(bough, fill(k % 2 ? '#2a4d34' : '#244530'));
    // Light from the top left: needles catch it along each bough's upper edge.
    const needles = stroke('#5f8a55', 0.12 * mm);
    needles.setStrokeCap(StrokeCap.Round);
    for (let i = 0; i < 6 + k; i++) {
      const u = rand();
      const side = u < 0.55 ? -1 : 1;
      const px = cx + side * u * half * 0.95;
      const py = yk + droop * 0.25 * Math.abs(px - cx) / half + range(rand, -0.2, 0.4) * mm;
      c.drawLine(px, py, px + side * 0.5 * mm, py + 0.45 * mm, needles);
    }
  }
  // Cones hang from the upper boughs.
  const cone = fill('#7b4f2c');
  for (let i = 0; i < 3; i++) {
    const t = 0.2 + i * 0.16;
    const yk = top + (bottom - top) * t;
    const side = i % 2 ? 1 : -1;
    const px = cx + side * (1.2 + i * 0.6) * mm;
    c.drawOval(Skia.XYWHRect(px - 0.32 * mm, yk + 1.1 * mm, 0.64 * mm, 1.5 * mm), cone);
  }
}

/** The «Р» definitive: self-adhesive, straight cut, the country over a spruce, its name under. */
function drawStampBY(c: SkCanvas, x: number, y: number, mm: number, seed: number, fonts: PostageFonts) {
  const rand = mulberry32(subSeed(seed, 'stamp'));
  const w = 18 * mm;
  const h = 26 * mm;
  c.save();
  c.rotate(wobble(rand, 1.6), x + w / 2, y + h / 2);
  stampPaper(c, x, y, w, h, mm, POSTAL.byStampGround);
  // A pale ground, a breath greener low down (offset print).
  const ground = Skia.Paint();
  ground.setShader(
    Skia.Shader.MakeLinearGradient({ x, y }, { x, y: y + h }, [Skia.Color('#f4f1e4'), Skia.Color('#e8ecda')], null, TileMode.Clamp),
  );
  c.drawRect(Skia.XYWHRect(x, y, w, h), ground);

  c.save();
  c.clipRect(Skia.XYWHRect(x + 0.6 * mm, y + 5.8 * mm, w - 1.2 * mm, 15.6 * mm), ClipOp.Intersect, true);
  drawSpruce(c, x + w * 0.5, y + 6.6 * mm, y + 21 * mm, 6.4 * mm, mm, rand);
  c.restore();

  const ink = fill(POSTAL.byStampText);
  const country = printFont(fonts.printBold, 2.3 * mm);
  c.drawText('БЕЛАРУСЬ', x + 1.2 * mm, y + 3.2 * mm, ink, country);
  const year = printFont(fonts.print, 1.6 * mm);
  c.drawText('2025', x + w - 1.2 * mm - textWidth(year, '2025'), y + 3.2 * mm, ink, year);
  c.drawText('BELARUS', x + 1.2 * mm, y + 5.1 * mm, ink, printFont(fonts.print, 1.45 * mm));
  // The rate letter, large in the corner: «Р», a priority letter abroad.
  const rate = printFont(fonts.printBold, 5.2 * mm);
  c.drawText('Р', x + w - 1 * mm - textWidth(rate, 'Р'), y + h - 1.1 * mm, ink, rate);
  // The species, Belarusian and Latin.
  c.drawText('Елка звычайная', x + 1.2 * mm, y + h - 2.7 * mm, ink, printFont(fonts.print, 1.3 * mm));
  const latin = printFont(fonts.print, 1.2 * mm);
  latin.setSkewX(-0.2);
  c.drawText('Picea abies', x + 1.2 * mm, y + h - 1.2 * mm, ink, latin);
  c.restore();
}

/** The blue priority label (UPU style), stuck on by the counter or the sender. */
function drawPriorityLabel(c: SkCanvas, x: number, y: number, mm: number, seed: number, fonts: PostageFonts) {
  const rand = mulberry32(subSeed(seed, 'label'));
  const w = 32 * mm;
  const h = 10 * mm;
  c.save();
  c.rotate(wobble(rand, 1.4), x + w / 2, y + h / 2);
  stampPaper(c, x, y, w, h, mm, POSTAL.priorityLabel);
  const white = fill('#f4f6fb');
  const big = printFont(fonts.printBold, 3.4 * mm);
  c.drawText('PRIORITAIRE', x + (w - textWidth(big, 'PRIORITAIRE')) / 2, y + 4.6 * mm, white, big);
  const small = printFont(fonts.print, 2.5 * mm);
  c.drawText('Par avion', x + (w - textWidth(small, 'Par avion')) / 2, y + 8 * mm, white, small);
  c.restore();
}

/** The calendar postmark, struck by hand over the stamp's corner: uneven violet ink, any angle. */
function drawPostmarkBY(c: SkCanvas, cx: number, cy: number, mm: number, pm: PostageMark, seed: number, fonts: PostageFonts) {
  const rand = mulberry32(subSeed(seed, 'postmark'));
  const r = 13.5 * mm;
  const tilt = rand() * Math.PI * 2;
  const ink = Skia.Paint();
  ink.setAntiAlias(true);
  ink.setShader(inkEffect().makeShader([...POSTAL.handPostmarkInk, seed % 89, cx, cy, Math.cos(tilt), Math.sin(tilt), r]));
  c.save();
  c.rotate(wobble(rand, 24), cx, cy);
  const ring = ink.copy();
  ring.setStyle(PaintStyle.Stroke);
  ring.setStrokeWidth(0.4 * mm);
  c.drawCircle(cx, cy, r, ring);
  const rim = printFont(fonts.printBold, 3 * mm);
  arcText(c, 'БЕЛАРУСЬ', rim, cx, cy, r * 0.8, true, ink);
  arcText(c, byOffice(pm.city), rim, cx, cy, r * 0.8, false, ink);
  // Two bars across, the date between them, the stamp's own number under the lower one.
  const bar = ring.copy();
  bar.setStrokeWidth(0.3 * mm);
  const by = r * 0.24;
  const half = Math.sqrt(r * r - by * by) * 0.9;
  c.drawLine(cx - half, cy - by, cx + half, cy - by, bar);
  c.drawLine(cx - half, cy + by, cx + half, cy + by, bar);
  const { dd, mo, yy } = dateParts(pm.date);
  const date = `${dd} ${mo} ${yy}`;
  const dateFont = printFont(fonts.printBold, 3.4 * mm);
  c.drawText(date, cx - textWidth(dateFont, date) / 2, cy + 1.2 * mm, ink, dateFont);
  const no = String(1 + (Math.abs(seed) % 9));
  const noFont = printFont(fonts.printBold, 2.2 * mm);
  c.drawText(no, cx - textWidth(noFont, no) / 2, cy + by + 2.6 * mm, ink, noFont);
  c.restore();
}

// ───────────────────────── France ─────────────────────────

/** Our profile before a globe, engraved: a head facing right, leafy hair flowing back. */
function drawProfile(c: SkCanvas, ox: number, oy: number, mm: number, violet: string, paper: string) {
  const P = (px: number, py: number) => [ox + px * mm, oy + py * mm] as const;
  // The globe behind: rim, meridians, parallels, in fine lines.
  const gx = ox + 9 * mm;
  const gy = oy + 10.6 * mm;
  const gr = 8.6 * mm;
  const fine = stroke(violet, 0.11 * mm);
  fine.setAlphaf(0.75);
  c.drawCircle(gx, gy, gr, stroke(violet, 0.16 * mm));
  for (const k of [0.35, 0.7]) c.drawOval(Skia.XYWHRect(gx - gr * k, gy - gr, gr * 2 * k, gr * 2), fine);
  c.drawLine(gx, gy - gr, gx, gy + gr, fine);
  for (const k of [-0.6, -0.25, 0.25, 0.6]) {
    const yy = gy + gr * k;
    const half = Math.sqrt(gr * gr - (gr * k) ** 2);
    c.drawLine(gx - half, yy, gx + half, yy, fine);
  }

  const head = Skia.PathBuilder.Make()
    .moveTo(...P(4.2, 20.5))
    .cubicTo(...P(4.6, 17.5), ...P(3.4, 15.2), ...P(3.6, 12.2))
    .cubicTo(...P(3.7, 7.4), ...P(6.2, 3.2), ...P(9.6, 3.1))
    .cubicTo(...P(11.8, 3.1), ...P(12.6, 5.2), ...P(12.5, 7.3))
    .lineTo(...P(12.7, 8.4))
    .cubicTo(...P(12.9, 9.3), ...P(13.6, 10.6), ...P(13.9, 11.4))
    .lineTo(...P(13.1, 11.8))
    .lineTo(...P(13.2, 12.6))
    .lineTo(...P(12.8, 13.0))
    .lineTo(...P(13.1, 13.6))
    .cubicTo(...P(13.0, 14.6), ...P(12.6, 15.4), ...P(11.6, 15.6))
    .cubicTo(...P(10.9, 15.8), ...P(10.6, 17.2), ...P(10.8, 20.5))
    .close()
    .detach();
  // The face: paper, lightly engraved with slanted lines, deeper towards the back.
  c.drawPath(head, fill(paper));
  c.save();
  c.clipPath(head, ClipOp.Intersect, true);
  const hatch = stroke(violet, 0.1 * mm);
  for (let i = -30; i < 60; i++) {
    const x0 = ox + i * 0.42 * mm;
    hatch.setAlphaf(0.25 + 0.55 * Math.max(0, Math.min(1, (ox + 12 * mm - x0) / (10 * mm))));
    c.drawLine(x0, oy + 21 * mm, x0 + 8 * mm, oy + 2 * mm, hatch);
  }
  c.restore();
  c.drawPath(head, stroke(violet, 0.17 * mm));
  // The eye, the line of the lips.
  const fineDark = stroke(violet, 0.14 * mm);
  c.drawLine(...P(11.3, 9.1), ...P(12.1, 9.0), fineDark);
  c.drawLine(...P(12.5, 13.05), ...P(12.95, 13.05), fineDark);

  // Leafy hair: leaves sprouting from the crown and the back of the head, fanning out behind it.
  const rib = stroke(paper, 0.09 * mm);
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    // Along the back of the head, from the crown down to the nape.
    const lx = 9.6 - 5.8 * Math.sin(t * 1.5);
    const ly = 3.3 + 12.2 * t;
    // Swept back: off the crown to the left, then ever more downward along the nape.
    const ang = 192 - 78 * t + (i % 2 ? 9 : -7);
    const len = 4.2 - 1.4 * Math.abs(t - 0.35);
    const leaf = fill(violet);
    leaf.setAlphaf(i % 2 ? 0.7 : 0.95);
    const [px, py] = P(lx, ly);
    c.save();
    c.translate(px, py);
    c.rotate(ang, 0, 0);
    const blade = Skia.PathBuilder.Make()
      .moveTo(0, 0)
      .quadTo(len * 0.5 * mm, -0.85 * mm, len * mm, 0)
      .quadTo(len * 0.5 * mm, 0.85 * mm, 0, 0)
      .close()
      .detach();
    c.drawPath(blade, leaf);
    c.drawLine(0.3 * mm, 0, (len - 0.5) * mm, 0, rib);
    c.restore();
  }
}

/** A DataMatrix-looking code: the L finder on two sides, the clock track on the others, data inside. */
function drawDataMatrix(c: SkCanvas, x: number, y: number, size: number, seed: number, violet: string) {
  const rand = mulberry32(subSeed(seed, 'datamatrix'));
  const n = 16;
  const cell = size / n;
  const ink = fill(violet);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const finder = col === 0 || row === n - 1;
      const clock = (row === 0 && col % 2 === 0) || (col === n - 1 && (n - 1 - row) % 2 === 0);
      const edge = row === 0 || col === n - 1;
      const on = finder || clock || (!edge && rand() < 0.48);
      if (on) c.drawRect(Skia.XYWHRect(x + col * cell, y + row * cell, cell * 1.02, cell * 1.02), ink);
    }
  }
}

/** The «Lettre internationale»: violet, landscape, perforated (a sheet stamp, gummed). */
function drawStampFR(c: SkCanvas, x: number, y: number, mm: number, seed: number, fonts: PostageFonts) {
  const rand = mulberry32(subSeed(seed, 'stamp'));
  const w = 40 * mm;
  const h = 26 * mm;
  const violet = POSTAL.frInternational;
  const paper = POSTAL.stampPaper;
  c.save();
  c.rotate(wobble(rand, 1.8), x + w / 2, y + h / 2);

  // Perforations, gauge 13: a hole every 2 cm / 13 along each edge.
  const hole = 0.5 * mm;
  const pitch = (20 / 13) * mm;
  const holes = Skia.PathBuilder.Make();
  for (let px = x; px <= x + w + 0.01; px += pitch) holes.addCircle(px, y, hole).addCircle(px, y + h, hole);
  for (let py = y; py <= y + h + 0.01; py += pitch) holes.addCircle(x, py, hole).addCircle(x + w, py, hole);
  c.save();
  c.clipPath(holes.detach(), ClipOp.Difference, true);
  stampPaper(c, x, y, w, h, mm, paper);
  c.restore();

  const m = 1.4 * mm;
  c.drawRect(Skia.XYWHRect(x + m, y + m, w - 2 * m, h - 2 * m), stroke(violet, 0.16 * mm));
  c.save();
  c.clipRect(Skia.XYWHRect(x + m, y + m, w - 2 * m, h - 2 * m), ClipOp.Intersect, true);
  drawProfile(c, x + 3.2 * mm, y + 2.2 * mm, mm, violet, paper);
  c.restore();

  const ink = fill(violet);
  const name = printFont(fonts.printBold, 2.7 * mm);
  c.drawText('FRANCE', x + 22.4 * mm, y + 4.6 * mm, ink, name);
  // The code, framed, on the right half.
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(x + 22 * mm, y + 5.8 * mm, 14.2 * mm, 14.2 * mm), 0.6 * mm, 0.6 * mm), stroke(violet, 0.18 * mm));
  drawDataMatrix(c, x + 23.1 * mm, y + 6.9 * mm, 12 * mm, seed, violet);
  const intl = printFont(fonts.print, 2.6 * mm);
  c.drawText('International', x + 21.8 * mm, y + 23.4 * mm, ink, intl);
  // «La Poste», up the left edge.
  c.save();
  c.translate(x + 2.9 * mm, y + 22.5 * mm);
  c.rotate(-90, 0, 0);
  c.drawText('La Poste', 0, 0, ink, printFont(fonts.print, 1.7 * mm));
  c.restore();
  c.restore();
}

/** The sorting machine's postmark: black inkjet, the centre's code and the date, wavy lines across the stamp. */
function drawPostmarkFR(c: SkCanvas, x0: number, y0: number, x1: number, mm: number, pm: PostageMark, seed: number, fonts: PostageFonts) {
  const rand = mulberry32(subSeed(seed, 'inkjet'));
  const ink = fill(POSTAL.inkjet);
  const font = printFont(fonts.printBold, 2.7 * mm);
  const { dd, mo, yy } = dateParts(pm.date);
  const line1 = `LA POSTE ${rocCode(pm.city, seed)}`;
  const line2 = `FRANCE ${dd}-${mo}-${yy}`;
  c.drawText(line1, x0, y0 + 2.7 * mm, ink, font);
  c.drawText(line2, x0, y0 + 6.4 * mm, ink, font);
  const waves = stroke(POSTAL.inkjet, 0.32 * mm);
  waves.setStrokeCap(StrokeCap.Round);
  const start = x0 + Math.max(textWidth(font, line1), textWidth(font, line2)) + 2.5 * mm;
  const phase = rand() * Math.PI * 2;
  for (let i = 0; i < 6; i++) {
    const yy0 = y0 - 6 * mm + i * 3.6 * mm;
    const path = Skia.PathBuilder.Make().moveTo(start, yy0);
    for (let x = start; x <= x1; x += 0.5 * mm) path.lineTo(x, yy0 + Math.sin((x - start) / (1.15 * mm) + phase) * 0.9 * mm);
    c.drawPath(path.detach(), waves);
  }
}

/**
 * The postage of a letter posted in `country`, in the top-right corner of an envelope
 * `w` × `h` px at `mm` px per millimetre.
 */
export function drawPostage(c: SkCanvas, w: number, h: number, mm: number, country: Country, pm: PostageMark, seed: number, fonts: PostageFonts) {
  if (country === 'by') {
    const sx = w - 11 * mm - 18 * mm;
    const sy = 7 * mm;
    drawStampBY(c, sx, sy, mm, seed, fonts);
    drawPriorityLabel(c, sx - 40 * mm, sy + 1.5 * mm, mm, seed, fonts);
    drawPostmarkBY(c, sx + 0.5 * mm, sy + 21 * mm, mm, pm, seed, fonts);
    return;
  }
  const sx = w - 9 * mm - 40 * mm;
  const sy = 7 * mm;
  drawStampFR(c, sx, sy, mm, seed, fonts);
  drawPostmarkFR(c, sx - 34 * mm, sy + 10 * mm, w - 2 * mm, mm, pm, seed, fonts);
}
