import {
  BlendMode,
  BlurStyle,
  ClipOp,
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

import { mulberry32, subSeed, wobble } from '../lib/random';
import { LIGHT_DIR, MAILBOX, PAPERS, POSTBOX, type PostboxSkin, type Rgb } from '../theme/stationery';
import { layoutHandwriting } from './handwriting';
import { measureWithFont, paperUniforms } from './renderLetter';
import { PAPER_SKSL, POWDER_SKSL } from './shaders';

/**
 * Painted-steel boxes: the street postbox the sender posts into, and the
 * подъезд mailbox bank the recipient opens. Baked once into pictures;
 * only doors, flaps and envelopes move.
 */

let cache: { powder: SkRuntimeEffect; paper: SkRuntimeEffect } | null = null;
function effects() {
  if (!cache) {
    const powder = Skia.RuntimeEffect.Make(POWDER_SKSL);
    const paper = Skia.RuntimeEffect.Make(PAPER_SKSL);
    if (!powder || !paper) throw new Error('Box shaders failed to compile');
    cache = { powder, paper };
  }
  return cache;
}

export function powderPaint(x: number, y: number, w: number, h: number, base: Rgb, primer: Rgb, seed: number, wear = 1): SkPaint {
  const p = Skia.Paint();
  p.setShader(effects().powder.makeShader([x, y, w, h, ...base, ...primer, seed % 97, LIGHT_DIR.x, LIGHT_DIR.y, wear]));
  p.setAntiAlias(true);
  return p;
}

function wallPaint(w: number, h: number, base: Rgb, seed: number) {
  const p = Skia.Paint();
  p.setShader(effects().paper.makeShader(paperUniforms({ ...PAPERS.cotton, base }, { width: w, height: h }, seed, 0)));
  return p;
}

const textW = (font: SkFont, s: string) => measureWithFont(font)(s);

function shadowed(paint: SkPaint, dx: number, dy: number, sigma: number, alpha: number) {
  const p = paint.copy();
  p.setImageFilter(Skia.ImageFilter.MakeDropShadow(dx, dy, sigma, sigma, Skia.Color(`rgba(15, 10, 5, ${alpha})`), null));
  return p;
}

function handwritten(c: SkCanvas, text: string, font: SkFont, x: number, y: number, color: string, seed: number) {
  const ink = Skia.Paint();
  ink.setColor(Skia.Color(color));
  ink.setAntiAlias(true);
  const layout = layoutHandwriting(text, measureWithFont(font), {
    seed,
    fontSize: font.getSize(),
    left: x,
    top: y,
    maxWidth: 1000,
    lineHeight: font.getSize() * 1.3,
  });
  for (const w of layout.words) {
    c.save();
    c.translate(w.x, w.y);
    c.rotate((w.rotation * 180) / Math.PI, 0, 0);
    c.drawText(w.text, 0, 0, ink, font);
    c.restore();
  }
}

// ───────────────────────── street postbox ─────────────────────────

export type PostboxLayout = {
  width: number;
  height: number;
  /** pt per mm: the slot (171 mm) and the envelope share this scale. */
  scale: number;
  slot: { x: number; y: number; w: number; h: number };
};

export function postboxLayout(width: number, height: number): PostboxLayout {
  // Close-up framing: the 171 × 6 mm slot spans ~70 % of the screen width.
  const scale = Math.min(1.6, (width * 0.72) / 171);
  const w = 171 * scale;
  return { width, height, scale, slot: { x: (width - w) / 2, y: height * 0.3, w, h: Math.max(6 * scale, 8) } };
}

export function recordPostbox(
  l: PostboxLayout,
  skin: PostboxSkin,
  collectAt: string,
  fonts: { print: SkTypeface; printBold: SkTypeface; marker: SkTypeface },
  seed: number,
): SkPicture {
  const { width: W, height: H, slot, scale: s } = l;
  const colors = POSTBOX[skin];
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording(Skia.XYWHRect(0, 0, W, H));

  c.drawRect(Skia.XYWHRect(0, 0, W, H), wallPaint(W, H, POSTBOX.wall, seed));

  // The box is wider than the screen (380 mm); its top edge sits above the slot.
  const boxW = 380 * s;
  const bx = (W - boxW) / 2;
  const by = slot.y - 70 * s;
  const boxRect = Skia.RRectXY(Skia.XYWHRect(bx, by, boxW, H - by + 40), 10 * s, 10 * s);
  // Side face peeking out on the right, then the front.
  const side = Skia.Paint();
  side.setColor(Skia.Color(colors.side));
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(bx + 8 * s, by + 4 * s, boxW, H), 10 * s, 10 * s), shadowed(side, 6, 10, 10, 0.45));
  c.drawRRect(boxRect, powderPaint(bx, by, boxW, H - by, colors.face, POSTBOX.primer, seed + 1));

  // Visor over the slot: a folded steel hood that throws a soft shadow.
  const visorH = 22 * s;
  const visorY = slot.y - visorH - 6 * s;
  const visor = Skia.RRectXY(Skia.XYWHRect(slot.x - 26 * s, visorY, slot.w + 52 * s, visorH), 4 * s, 4 * s);
  const hood = powderPaint(bx, visorY, boxW, visorH, colors.face.map((v) => v * 1.06) as unknown as Rgb, POSTBOX.primer, seed + 2, 0.6);
  c.drawRRect(visor, shadowed(hood, 0, 5 * s, 4 * s, 0.4));
  const lip = Skia.Paint();
  lip.setShader(
    Skia.Shader.MakeLinearGradient(
      { x: 0, y: visorY },
      { x: 0, y: visorY + visorH },
      [Skia.Color('rgba(255,255,255,0.18)'), Skia.Color('rgba(255,255,255,0)'), Skia.Color('rgba(0,0,0,0.18)')],
      [0, 0.4, 1],
      TileMode.Clamp,
    ),
  );
  c.drawRRect(visor, lip);

  // The slot: a dark gap with an inner bevel and a painted lip below it.
  const slotR = Skia.RRectXY(Skia.XYWHRect(slot.x, slot.y, slot.w, slot.h), slot.h / 2, slot.h / 2);
  const bevel = Skia.Paint();
  bevel.setColor(Skia.Color('rgba(0,0,0,0.35)'));
  bevel.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 2.5, true));
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(slot.x - 3, slot.y - 2, slot.w + 6, slot.h + 6), slot.h, slot.h), bevel);
  const inside = Skia.Paint();
  inside.setShader(
    Skia.Shader.MakeLinearGradient({ x: 0, y: slot.y }, { x: 0, y: slot.y + slot.h }, POSTBOX.slotInside.map((x) => Skia.Color(x)), null, TileMode.Clamp),
  );
  c.drawRRect(slotR, inside);
  const lipLine = Skia.Paint();
  lipLine.setColor(Skia.Color(POSTBOX.slotLip));
  lipLine.setStyle(PaintStyle.Stroke);
  lipLine.setStrokeWidth(Math.max(1.2, 0.9 * s));
  c.drawLine(slot.x + slot.h / 2, slot.y + slot.h + 1.6 * s, slot.x + slot.w - slot.h / 2, slot.y + slot.h + 1.6 * s, lipLine);

  // ПОЧТА + an original emblem (a stylised envelope in a circle), recessed steel.
  const word = 'ПОЧТА';
  const big = Skia.Font(fonts.printBold, 46 * s);
  const ty = slot.y + 78 * s;
  const emboss = (draw: (p: SkPaint) => void) => {
    const dark = Skia.Paint();
    dark.setColor(Skia.Color('rgba(0,0,0,0.25)'));
    dark.setAntiAlias(true);
    c.save();
    c.translate(0.8, 1.2);
    draw(dark);
    c.restore();
    const light = Skia.Paint();
    light.setColor(Skia.Color('rgba(245, 247, 250, 0.96)'));
    light.setAntiAlias(true);
    draw(light);
  };
  emboss((p) => c.drawText(word, (W - textW(big, word)) / 2 + 14 * s, ty, p, big));
  const ex = (W - textW(big, word)) / 2 - 18 * s;
  const ey = ty - 16 * s;
  emboss((p) => {
    const ring = p.copy();
    ring.setStyle(PaintStyle.Stroke);
    ring.setStrokeWidth(2.4 * s);
    c.drawCircle(ex, ey, 17 * s, ring);
    const env = Skia.PathBuilder.Make()
      .addRect(Skia.XYWHRect(ex - 10 * s, ey - 6.5 * s, 20 * s, 13 * s))
      .moveTo(ex - 10 * s, ey - 6.5 * s)
      .lineTo(ex, ey + 1.5 * s)
      .lineTo(ex + 10 * s, ey - 6.5 * s)
      .detach();
    const stroke = p.copy();
    stroke.setStyle(PaintStyle.Stroke);
    stroke.setStrokeWidth(1.8 * s);
    c.drawPath(env, stroke);
  });

  // Collection sticker, filled in by hand like the real ones.
  const stW = 74 * s;
  const stH = 46 * s;
  // Keep it on screen: the box itself is wider than the view.
  const sx = Math.min(bx + boxW - stW - 26 * s, W - stW - 18);
  const sy = ty + 26 * s;
  const rand = mulberry32(subSeed(seed, 'sticker'));
  c.save();
  c.rotate(wobble(rand, 1.2), sx + stW / 2, sy + stH / 2);
  const paper = Skia.Paint();
  paper.setColor(Skia.Color('#f4f2ea'));
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(sx, sy, stW, stH), 2, 2), shadowed(paper, 0.5, 1, 1, 0.3));
  const printed = Skia.Paint();
  printed.setColor(Skia.Color('rgba(30, 50, 100, 0.85)'));
  printed.setAntiAlias(true);
  const small = Skia.Font(fonts.printBold, 7.5 * s);
  c.drawText('ВЫЕМКА ПИСЕМ', sx + 5 * s, sy + 10 * s, printed, small);
  const rule = printed.copy();
  rule.setStyle(PaintStyle.Stroke);
  rule.setStrokeWidth(0.6);
  c.drawLine(sx + 5 * s, sy + 13 * s, sx + stW - 5 * s, sy + 13 * s, rule);
  c.drawLine(sx + 5 * s, sy + 33 * s, sx + stW - 5 * s, sy + 33 * s, rule);
  const tiny = Skia.Font(fonts.print, 5.5 * s);
  c.drawText('время местное', sx + 5 * s, sy + 41 * s, printed, tiny);
  handwritten(c, collectAt, Skia.Font(fonts.marker, 17 * s), sx + 9 * s, sy + 29 * s, '#1b1d2b', seed + 7);
  c.restore();

  // Ambient occlusion where the box meets the wall at the top.
  const ao = Skia.Paint();
  ao.setColor(Skia.Color('rgba(0,0,0,0.25)'));
  ao.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 6, true));
  c.save();
  c.clipRRect(boxRect, ClipOp.Difference, true);
  c.drawRect(Skia.XYWHRect(bx - 4, by - 2, boxW + 8, 6), ao);
  c.restore();

  return rec.finishRecordingAsPicture();
}

// ───────────────────────── подъезд mailbox bank ─────────────────────────

export type MailboxLayout = {
  width: number;
  height: number;
  scale: number;
  /** Our cell's door, in scene coordinates. */
  door: { x: number; y: number; w: number; h: number };
  holes: { x: number; y: number; r: number }[];
  lock: { x: number; y: number; r: number };
};

export function mailboxLayout(width: number, height: number): MailboxLayout {
  // A 190 × 125 mm door fills ~80 % of the width; neighbours are cut off at the edges.
  const scale = Math.min(1.7, (width * 0.8) / 190);
  const w = 190 * scale;
  const h = 125 * scale;
  const x = (width - w) / 2;
  const y = height * 0.18;
  const r = 4 * scale;
  const holes = Array.from({ length: 6 }, (_, i) => ({ x: x + w * 0.22 + i * 14 * scale, y: y + h * 0.42, r }));
  return { width, height, scale, door: { x, y, w, h }, holes, lock: { x: x + w * 0.82, y: y + h * 0.5, r: 7 * scale } };
}

/** Wall, frame, neighbouring doors: everything that never moves. Our cell is left as a dark opening. */
export function recordMailboxBank(l: MailboxLayout, flat: number, seed: number, numberFont: SkTypeface): SkPicture {
  const { width: W, height: H, door, scale: s } = l;
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording(Skia.XYWHRect(0, 0, W, H));
  c.drawRect(Skia.XYWHRect(0, 0, W, H), wallPaint(W, H, MAILBOX.wall, seed));

  const gap = 6 * s;
  const pitchX = door.w + gap;
  const pitchY = door.h + gap;
  const bankX = door.x - pitchX - gap;
  const bankY = door.y - pitchY - gap;
  const bankW = pitchX * 3 + gap;
  const bankH = pitchY * 3 + gap;
  const frame = powderPaint(bankX, bankY, bankW, bankH, MAILBOX.frame, MAILBOX.primer, seed + 1, 0.5);
  c.drawRect(Skia.XYWHRect(bankX, bankY, bankW, bankH), shadowed(frame, 4, 8, 10, 0.4));

  const label = Skia.Font(numberFont, 9 * s);
  for (let row = -1; row <= 1; row++) {
    for (let col = -1; col <= 1; col++) {
      const x = door.x + col * pitchX;
      const y = door.y + row * pitchY;
      // Our own cell: the opening; the door is drawn live on top.
      const opening = Skia.Paint();
      opening.setColor(Skia.Color(MAILBOX.interior));
      c.drawRect(Skia.XYWHRect(x, y, door.w, door.h), opening);
      if (row === 0 && col === 0) continue;
      drawDoorFace(c, l, x, y, seed + 10 + row * 3 + col, flat + row * 3 + col, label, false);
    }
  }
  return rec.finishRecordingAsPicture();
}

/** A door face in its own coordinates offset by (x, y). Also used live for our door. */
export function drawDoorFace(
  c: SkCanvas,
  l: MailboxLayout,
  x: number,
  y: number,
  seed: number,
  flat: number,
  font: SkFont,
  withHoles: boolean,
) {
  const { door, scale: s } = l;
  const face = powderPaint(x, y, door.w, door.h, MAILBOX.face, MAILBOX.primer, seed);
  c.drawRect(Skia.XYWHRect(x, y, door.w, door.h), face);
  // Pressed rim around the door.
  const rim = Skia.Paint();
  rim.setStyle(PaintStyle.Stroke);
  rim.setStrokeWidth(1.2);
  rim.setColor(Skia.Color('rgba(0,0,0,0.18)'));
  c.drawRect(Skia.XYWHRect(x + 3 * s, y + 3 * s, door.w - 6 * s, door.h - 6 * s), rim);
  // Slot along the top.
  const slot = Skia.Paint();
  slot.setColor(Skia.Color('#151311'));
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(x + door.w * 0.15, y + door.h * 0.14, door.w * 0.7, 5 * s), 2.5 * s, 2.5 * s), slot);
  // Peek holes (ours are drawn live so the envelope can show through).
  const dx = l.holes[0].x - door.x;
  const dy = l.holes[0].y - door.y;
  if (withHoles) {
    for (let i = 0; i < 6; i++) {
      c.drawCircle(x + dx + i * 14 * s, y + dy, l.holes[0].r, slot);
    }
  }
  // Cylinder lock.
  const lx = x + (l.lock.x - door.x);
  const ly = y + (l.lock.y - door.y);
  const ring = Skia.Paint();
  ring.setShader(
    Skia.Shader.MakeRadialGradient({ x: lx - 2, y: ly - 2 }, l.lock.r * 1.3, [Skia.Color('#e6e3dc'), Skia.Color('#8d8a84')], null, TileMode.Clamp),
  );
  c.drawCircle(lx, ly, l.lock.r, shadowed(ring, 0.6, 1, 1, 0.4));
  const keyway = Skia.Paint();
  keyway.setColor(Skia.Color('#2b2925'));
  c.drawRect(Skia.XYWHRect(lx - l.lock.r * 0.12, ly - l.lock.r * 0.55, l.lock.r * 0.24, l.lock.r * 1.1), keyway);
  // Flat number, painted by hand with a stencil.
  const num = String(flat);
  const ink = Skia.Paint();
  ink.setColor(Skia.Color('rgba(40, 40, 45, 0.85)'));
  ink.setBlendMode(BlendMode.Multiply);
  c.drawText(num, x + door.w * 0.1, y + door.h * 0.8, ink, font);
}

/** Our door, both faces: outside (number, lock, holes) and inside (bare painted steel). */
export function recordDoor(l: MailboxLayout, flat: number, seed: number, numberFont: SkTypeface) {
  const { door } = l;
  const out = Skia.PictureRecorder();
  const c = out.beginRecording(Skia.XYWHRect(door.x - 10, door.y - 10, door.w + 20, door.h + 20));
  drawDoorFace(c, l, door.x, door.y, seed, flat, Skia.Font(numberFont, 9 * l.scale), true);
  const outside = out.finishRecordingAsPicture();

  const inn = Skia.PictureRecorder();
  const ci = inn.beginRecording(Skia.XYWHRect(door.x - 10, door.y - 10, door.w + 20, door.h + 20));
  ci.drawRect(Skia.XYWHRect(door.x, door.y, door.w, door.h), powderPaint(door.x, door.y, door.w, door.h, MAILBOX.face.map((v) => v * 0.8) as unknown as Rgb, MAILBOX.primer, seed + 5, 0.3));
  const inside = inn.finishRecordingAsPicture();
  return { outside, inside };
}
