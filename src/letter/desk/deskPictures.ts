import {
  BlendMode,
  BlurStyle,
  ClipOp,
  PaintStyle,
  Skia,
  TileMode,
  type SkCanvas,
  type SkPicture,
  type SkRuntimeEffect,
} from '@shopify/react-native-skia';

import { subSeed } from '../../lib/random';
import type { SheetPaper } from '../../theme/kinds';
import { DESK, LIGHT_DIR, type Country } from '../../theme/stationery';
import { LEATHER_SKSL, WOOD_SKSL } from './deskShaders';
import {
  DESK_PRESETS,
  deskLamp,
  estimatedSheet,
  lampIn,
  leatherUniforms,
  woodUniforms,
  type Lamp,
  type WoodSpec,
} from './deskUniforms';
import {
  blurred,
  dropShadow,
  fill,
  record,
  recordBottle,
  recordEnvelopeStock,
  recordInkRing,
  recordPaperStack,
  recordPen,
  recordPenGroove,
  rgba,
  stroke,
} from './items';
import { DRAWER_WALL, ITEM_MM, padRectFor, restingPlaces } from './layout';
import { drawerSlots } from './slots';
import {
  DRAWERS,
  PENS,
  itemSeed,
  type DeskItem,
  type DeskLayout,
  type DrawerKey,
  type InUse,
  type Rect,
  type RestingLook,
} from './types';
import { perfCount } from '../../lib/perfCounters';

/**
 * The desk's static pictures (spec §5.4): the underlay (wood, sous-main, the sheet's contact shadow,
 * the laptop's resting items), the apron band with its three closed fronts, the nosing strip, and each
 * drawer's box (interior, items, front). Each is recorded once per input and shown by one static canvas;
 * everything that moves is a view transform. Kept apart from the components so node can render them.
 */

let woodEffect: SkRuntimeEffect | null = null;
let leatherEffect: SkRuntimeEffect | null = null;
function effects() {
  woodEffect ??= Skia.RuntimeEffect.Make(WOOD_SKSL);
  leatherEffect ??= Skia.RuntimeEffect.Make(LEATHER_SKSL);
  if (!woodEffect || !leatherEffect) throw new Error('Desk shaders failed to compile');
  return { wood: woodEffect, leather: leatherEffect };
}

/** Fills `rect` with wood; the grain and the lamp are in the rect's own coordinates. */
function drawWood(
  c: SkCanvas,
  spec: Country | WoodSpec,
  rect: Rect,
  seed: number,
  scale: number,
  face: boolean,
  lamp: Lamp,
  wearY?: number,
) {
  const p = Skia.Paint();
  p.setShader(
    effects().wood.makeShader(
      woodUniforms(spec, rect, seed, scale, face, lampIn(lamp, rect), wearY === undefined ? undefined : wearY - rect.y),
    ),
  );
  c.save();
  c.translate(rect.x, rect.y);
  c.drawRect(Skia.XYWHRect(0, 0, rect.width, rect.height), p);
  c.restore();
}

const gradient = (
  c: SkCanvas,
  rect: Rect,
  from: { x: number; y: number },
  to: { x: number; y: number },
  colors: Float32Array[],
  pos: number[] | null = null,
) => {
  const p = Skia.Paint();
  p.setShader(Skia.Shader.MakeLinearGradient(from, to, colors, pos, TileMode.Clamp));
  c.drawRect(Skia.XYWHRect(rect.x, rect.y, rect.width, rect.height), p);
};

/** A face board (apron, fronts) is one long board: no seams across it. */
const faceWood = (preset: Country): WoodSpec => ({ ...DESK_PRESETS[preset].wood, boards: 1 });

/**
 * Pictures by key for the components: a pure function of their props, so a keystroke elsewhere never
 * re-records (and the React Compiler needs no manual memo). A few recent ones are kept.
 */
const pictures = new Map<string, SkPicture>();
export function keptPicture(key: string, make: () => SkPicture): SkPicture {
  let p = pictures.get(key);
  if (p) {
    pictures.delete(key);
  } else {
    perfCount('recordDesk');
    p = make();
    if (pictures.size >= 16) pictures.delete(pictures.keys().next().value as string);
  }
  pictures.set(key, p);
  return p;
}

/** What a layout's pictures depend on, as a key. */
export const layoutKey = (l: DeskLayout) => `${l.width}x${l.height}:${l.insets.top},${l.insets.bottom}:${l.sheet.width}`;

// ---------------------------------------------------------------- the fronts

/** Size factor of the fronts' furniture (card holder, pull): 1 on a phone's 44 pt fronts. */
export const frontK = (layout: DeskLayout) => layout.band.fronts / 44;

/** The brass card holder's card on a front of this size (front-local pt): where the label Text goes. */
export function cardRect(width: number, height: number): Rect {
  const k = height / 44;
  const w = 56 * k;
  const h = 16 * k;
  return { x: (width - w) / 2, y: Math.round(height * 0.13), width: w, height: h };
}

const frontSeed = (seed: number, drawer: DrawerKey) => subSeed(seed, `front.${drawer}`);

/**
 * One drawer front in its own coordinates (0, 0)–(w, h): its own board (a vertical face), a small
 * ovolo round the panel (lit top and left, dark bottom and right), a cock-bead, a brass card holder
 * (the label is an RN Text over it) and the pull: a bail (fr) or a round knob (ru).
 * `lamp` is in the front's coordinates, so the apron and the drawer box draw identical pixels.
 */
export function drawFront(c: SkCanvas, w: number, h: number, preset: Country, seed: number, far: number, lamp: Lamp) {
  const P = DESK_PRESETS[preset];
  const k = h / 44;
  drawWood(c, faceWood(preset), { x: 0, y: 0, width: w, height: h }, seed, far, true, lamp);
  const bw = Math.max(1, 1.3 * k);
  c.drawLine(0, bw / 2, w, bw / 2, stroke(rgba(1, 0.88, 0.7, 0.2), bw));
  c.drawLine(bw / 2, 0, bw / 2, h, stroke(rgba(1, 0.88, 0.7, 0.09), bw));
  c.drawLine(0, h - bw / 2, w, h - bw / 2, stroke(rgba(0, 0, 0, 0.38), bw));
  c.drawLine(w - bw / 2, 0, w - bw / 2, h, stroke(rgba(0, 0, 0, 0.22), bw));
  // The cock-bead: a fine moulding 3.5 pt in, its shadow under it and a lit line over it.
  const inset = 3.5 * k;
  const lw = Math.max(0.5, 0.6 * k);
  c.drawRect(Skia.XYWHRect(inset + 0.5, inset + 0.5, w - 2 * inset, h - 2 * inset), stroke(rgba(0, 0, 0, 0.24), lw));
  c.drawRect(Skia.XYWHRect(inset - 0.3, inset - 0.3, w - 2 * inset, h - 2 * inset), stroke(rgba(1, 0.9, 0.75, 0.09), lw));

  // The card holder: a brass frame open at the top, the card in it, two pins.
  const card = cardRect(w, h);
  c.drawRect(
    Skia.XYWHRect(card.x + 0.6 * k, card.y + 1.1 * k, card.width, card.height),
    blurred(rgba(0.04, 0.02, 0.01, 0.45), 0.9 * k),
  );
  c.drawRect(Skia.XYWHRect(card.x, card.y, card.width, card.height), fill(Skia.Color(P.card)));
  // A little grime toward the card's edges.
  c.drawRect(Skia.XYWHRect(card.x, card.y, card.width, card.height), stroke(rgba(0.35, 0.25, 0.15, 0.18), 2 * k));
  const frame = Skia.Paint();
  frame.setAntiAlias(true);
  const fw = Math.max(1, 1.8 * k);
  frame.setStyle(PaintStyle.Stroke);
  frame.setStrokeWidth(fw);
  const lit = P.brass.lit;
  const dk = P.brass.shade;
  frame.setShader(
    Skia.Shader.MakeLinearGradient(
      { x: card.x, y: card.y },
      { x: card.x + card.width, y: card.y + card.height },
      [rgba(lit[0] * 1.3, lit[1] * 1.3, lit[2] * 1.25), rgba(lit[0], lit[1], lit[2]), rgba(dk[0], dk[1], dk[2])],
      [0, 0.45, 1],
      TileMode.Clamp,
    ),
  );
  const holder = Skia.PathBuilder.Make()
    .moveTo(card.x + 3 * k, card.y + 1.2 * k)
    .lineTo(card.x - fw / 2, card.y + 1.2 * k)
    .lineTo(card.x - fw / 2, card.y + card.height + fw / 2)
    .lineTo(card.x + card.width + fw / 2, card.y + card.height + fw / 2)
    .lineTo(card.x + card.width + fw / 2, card.y + 1.2 * k)
    .lineTo(card.x + card.width - 3 * k, card.y + 1.2 * k)
    .detach();
  c.drawPath(holder, frame);
  const pin = fill(rgba(dk[0] * 0.8, dk[1] * 0.8, dk[2] * 0.8, 1));
  c.drawCircle(card.x - 3.4 * k, card.y + card.height / 2, 0.9 * k, pin);
  c.drawCircle(card.x + card.width + 3.4 * k, card.y + card.height / 2, 0.9 * k, pin);

  // The pull.
  const cx = w / 2;
  const cy = h * 0.74;
  const sx = -LIGHT_DIR.x;
  const sy = -LIGHT_DIR.y;
  const brass = (x: number, y: number, r: number) => {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    p.setShader(
      Skia.Shader.MakeRadialGradient(
        { x: x + LIGHT_DIR.x * r * 0.4, y: y + LIGHT_DIR.y * r * 0.4 },
        r * 1.3,
        [rgba(1, 0.9, 0.62), rgba(lit[0], lit[1], lit[2]), rgba(dk[0] * 0.75, dk[1] * 0.75, dk[2] * 0.75)],
        [0, 0.4, 1],
        TileMode.Clamp,
      ),
    );
    return p;
  };
  if (P.pull === 'bail') {
    // Two rosettes 28 pt apart and the bail hanging from them in a shallow U (about 34 × 8 pt).
    const span = 28 * k;
    const ro = 3.2 * k;
    for (const x of [cx - span / 2, cx + span / 2]) {
      c.drawOval(
        Skia.XYWHRect(x - ro + sx * 1.2 * k, cy - ro * 0.75 + sy * 1.2 * k, 2 * ro, 1.5 * ro),
        blurred(rgba(0.05, 0.03, 0.01, 0.5), 0.8 * k),
      );
      c.drawOval(Skia.XYWHRect(x - ro, cy - ro * 0.75, 2 * ro, 1.5 * ro), brass(x, cy, ro));
      c.drawOval(
        Skia.XYWHRect(x - ro * 0.6, cy - ro * 0.45, 1.2 * ro, 0.9 * ro),
        stroke(rgba(0.3, 0.2, 0.08, 0.5), Math.max(0.4, 0.4 * k)),
      );
    }
    const drop = 6.5 * k;
    const bail = Skia.PathBuilder.Make()
      .moveTo(cx - span / 2, cy)
      .cubicTo(cx - span / 2, cy + drop * 1.25, cx - span * 0.25, cy + drop, cx, cy + drop)
      .cubicTo(cx + span * 0.25, cy + drop, cx + span / 2, cy + drop * 1.25, cx + span / 2, cy)
      .detach();
    const sh = stroke(rgba(0.04, 0.02, 0.01, 0.45), 2.2 * k);
    sh.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 1 * k, true));
    c.save();
    c.translate(sx * 2 * k, sy * 2.6 * k);
    c.drawPath(bail, sh);
    c.restore();
    c.drawPath(bail, stroke(rgba(dk[0] * 0.8, dk[1] * 0.8, dk[2] * 0.8), 2.4 * k));
    c.save();
    c.translate(0, -0.35 * k);
    c.drawPath(bail, stroke(rgba(lit[0], lit[1], lit[2]), 1.4 * k));
    c.translate(-0.15 * k, -0.3 * k);
    c.drawPath(bail, stroke(rgba(1, 0.92, 0.7, 0.75), 0.55 * k));
    c.restore();
  } else {
    // A turned brass knob, about 9 pt across, its shadow on the wood.
    const r = 4.5 * k;
    c.drawCircle(cx + sx * 2.2 * k, cy + sy * 2.6 * k, r, blurred(rgba(0.04, 0.02, 0.01, 0.55), 1.3 * k));
    c.drawCircle(cx, cy, r, brass(cx, cy, r));
    c.drawCircle(cx, cy, r * 0.55, stroke(rgba(0.3, 0.2, 0.08, 0.35), Math.max(0.4, 0.4 * k)));
    c.drawCircle(cx, cy, r - 0.3 * k, stroke(rgba(0.2, 0.13, 0.05, 0.5), Math.max(0.4, 0.5 * k)));
  }
}

// ---------------------------------------------------------------- the lamp per canvas

/** The lamp on screen for canvases that don't know where the sheet is (the band, the drawers). */
export const screenLamp = (layout: DeskLayout) => deskLamp(estimatedSheet(layout));

// ---------------------------------------------------------------- the band

/**
 * The fixed band at the bottom of the screen, in its own coordinates (0 at the band's top): the
 * nosing, the apron board (rails), the three closed fronts in their dark reveals, the shadow under
 * the apron (the knee) and the floor down to the screen's bottom.
 */
export function recordApron(layout: DeskLayout, preset: Country, seed: number): SkPicture {
  const { band, width: W } = layout;
  const lamp = lampIn(screenLamp(layout), { x: 0, y: band.top });
  const far = layout.far;
  const apronTop = band.nosing;
  const apronBottom = band.nosing + band.fronts + band.rail;
  return record({ x: 0, y: 0, width: W, height: band.height }, (c) => {
    // The floor, far below in the desk's shadow: a flat gradient (no grain: the reused arcs showed).
    gradient(
      c,
      { x: 0, y: apronBottom, width: W, height: band.height - apronBottom },
      { x: 0, y: apronBottom },
      { x: 0, y: band.height },
      [Skia.Color(DESK.floor[0]), Skia.Color(DESK.floor[1])],
    );
    // The apron board: one long board across, a vertical face.
    drawWood(
      c,
      faceWood(preset),
      { x: 0, y: apronTop, width: W, height: apronBottom - apronTop },
      subSeed(seed, 'apron'),
      far,
      true,
      lamp,
    );
    // Its lower edge: a lit fillet, then the shadow line under it, then the knee's shadow on the floor.
    c.drawRect(Skia.XYWHRect(0, apronBottom - 1, W, 1), fill(rgba(0, 0, 0, 0.45)));
    gradient(
      c,
      { x: 0, y: apronBottom, width: W, height: band.knee },
      { x: 0, y: apronBottom },
      { x: 0, y: apronBottom + band.knee },
      [rgba(0.02, 0.012, 0.008, 0.85), rgba(0.02, 0.012, 0.008, 0)],
    );
    // Each front sits in a dark reveal (the gap round the drawer).
    for (const key of DRAWERS) {
      const f = layout.fronts[key];
      const y = f.y - band.top;
      c.drawRect(Skia.XYWHRect(f.x - 1.2, y - 1, f.width + 2.4, f.height + 2), fill(rgba(0.035, 0.024, 0.017, 1)));
    }
    for (const key of DRAWERS) {
      const f = layout.fronts[key];
      c.save();
      c.translate(f.x, f.y - band.top);
      drawFront(c, f.width, f.height, preset, frontSeed(seed, key), far, lampIn(lamp, { x: f.x, y: f.y - band.top }));
      c.restore();
    }
    drawNosing(c, layout, preset, seed, lamp);
  });
}

/** The nosing: the rounded near edge of the top, seen from above. A lit lip, rolling into shade. */
function drawNosing(c: SkCanvas, layout: DeskLayout, preset: Country, seed: number, lamp: Lamp) {
  const W = layout.width;
  const n = layout.band.nosing;
  drawWood(c, preset, { x: 0, y: 0, width: W, height: n }, subSeed(seed, 'top'), layout.near, false, lamp);
  gradient(
    c,
    { x: 0, y: 0, width: W, height: n },
    { x: 0, y: 0 },
    { x: 0, y: n },
    [rgba(1, 0.9, 0.75, 0.05), rgba(1, 0.9, 0.75, 0.2), rgba(0, 0, 0, 0.12), rgba(0.02, 0.01, 0, 0.42)],
    [0, 0.25, 0.6, 1],
  );
  c.drawLine(0, 0.5, W, 0.5, stroke(rgba(0, 0, 0, 0.25), 1));
}

/** The nosing strip on its own (it sits above an open drawer's box): W × band.nosing. */
export function recordNosing(layout: DeskLayout, preset: Country, seed: number): SkPicture {
  const lamp = lampIn(screenLamp(layout), { x: 0, y: layout.band.top });
  return record({ x: 0, y: 0, width: layout.width, height: layout.band.nosing }, (c) =>
    drawNosing(c, layout, preset, seed, lamp),
  );
}

/** How far (pt) the desk edge's shadow reaches into an open drawer, and how dark it starts. */
export const EDGE_SHADOW = { depth: 32, alpha: 0.5 } as const;

/**
 * The desk edge's shadow falling into an open drawer (50 % → 0 over 32 pt), W × depth: for a scene that
 * wants it to follow the moving desk edge rather than the drawer (the box draws it at its top, where it is at t = 1).
 */
export function recordEdgeShadow(width: number, depth: number = EDGE_SHADOW.depth): SkPicture {
  return record({ x: 0, y: 0, width, height: depth }, (c) =>
    gradient(c, { x: 0, y: 0, width, height: depth }, { x: 0, y: 0 }, { x: 0, y: depth }, [
      rgba(0.02, 0.01, 0.005, EDGE_SHADOW.alpha),
      rgba(0.02, 0.01, 0.005, 0),
    ]),
  );
}

// ---------------------------------------------------------------- a drawer

/** Draws an item's picture into its slot rect, turned about its centre (radians). */
function placeItem(c: SkCanvas, picture: SkPicture, rect: Rect, rotation: number, lift = 1) {
  c.save();
  c.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
  if (rotation) c.rotate((rotation * 180) / Math.PI, 0, 0);
  if (lift !== 1) c.scale(lift, lift);
  c.translate(-rect.width / 2, -rect.height / 2);
  c.drawPicture(picture);
  c.restore();
}

/**
 * An item's picture at this scale (what the drawer, the carry and the laptop's desk draw). `pixelRatio`:
 * the screen's, so fine printed patterns (an envelope's liner) fade where they would alias.
 */
export function itemPicture(item: DeskItem, scale: number, seed: number, angle = 0, pixelRatio = 2): SkPicture {
  const s = itemSeed(seed, item.id);
  switch (item.kind) {
    case 'paper':
      return recordPaperStack(item.paper, scale, s);
    case 'envelope':
      return recordEnvelopeStock(item.paper, item.liner, scale, s, true, pixelRatio);
    case 'pen':
      return recordPen(item.pen, scale, true, angle);
    case 'ink':
      return recordBottle(item.ink, scale, s);
  }
}

/**
 * One drawer's box in its own coordinates: the interior (depth H, the drawer's walls at its sides) on
 * top, the front (the band's front height) under it at y = H. At t = 0 the front lies exactly over the
 * apron's closed front (same pixels); the interior hides under the scroll view.
 * Paper and envelopes lie on bare oak; the pen tray is felt with a groove per pen. The pen in use leaves
 * its groove empty (a faint outline), the bottle in use leaves a ring. `lifted`: an item id shown lifted
 * in its slot (scale 1.05, the carry shadow).
 */
export function recordDrawerBox(
  drawer: DrawerKey,
  layout: DeskLayout,
  preset: Country,
  seed: number,
  inUse: InUse,
  lifted?: string,
  pixelRatio = 2,
): SkPicture {
  const P = DESK_PRESETS[preset];
  const f = layout.fronts[drawer];
  const g = layout.drawers[drawer];
  const W = f.width;
  const H = g.depth;
  const far = layout.far;
  const wall = DRAWER_WALL;
  const lamp = screenLamp(layout);
  // The interior is seen at t = 1; the front must match the apron's at t = 0.
  const inside = lampIn(lamp, { x: f.x, y: f.y - g.travel - H });
  const floor: Rect = { x: wall, y: 0, width: W - 2 * wall, height: H };
  const slots = drawerSlots(drawer, layout, inUse);
  return record({ x: 0, y: 0, width: W, height: H + f.height }, (c) => {
    // The floor: bare oak boards (a drawer bottom), or the pen tray's felt.
    if (drawer === 'pens') {
      const p = Skia.Paint();
      p.setShader(
        effects().leather.makeShader(
          leatherUniforms(P.felt, floor, subSeed(seed, 'felt'), far, { felt: true, radius: 0.5, lamp: lampIn(inside, floor) }),
        ),
      );
      c.save();
      c.translate(floor.x, floor.y);
      c.drawRect(Skia.XYWHRect(0, 0, floor.width, floor.height), p);
      c.restore();
    } else {
      drawWood(c, P.interior, floor, subSeed(seed, `floor.${drawer}`), far, false, inside);
    }

    c.save();
    c.clipRect(Skia.XYWHRect(floor.x, floor.y, floor.width, floor.height), ClipOp.Intersect, true);
    c.translate(wall, 0);
    // Pen grooves under everything in the tray.
    for (const s of slots) if (s.item.kind === 'pen') placeItem(c, recordPenGroove(s.item.pen, far, s.inUse), s.rect, s.rotation);
    // Back to front, so nearer items lie over the ones behind them.
    for (const s of [...slots].reverse()) {
      if (s.inUse && s.item.kind === 'pen') continue;
      if (s.inUse && s.item.kind === 'ink') {
        placeItem(c, recordInkRing(s.item.ink, far, itemSeed(seed, s.item.id)), s.rect, s.rotation);
        continue;
      }
      // A lifted item is drawn last, over the walls (it is above the drawer).
      if (s.item.id === lifted) continue;
      // Stock envelopes lie with their flaps closed, so each strip shows its own body and flap edge; only
      // the front one stands open on its liner (a lifted one opens too).
      // (An envelope fitted to a narrow drawer is drawn at its fitted scale.)
      const k = s.item.kind === 'envelope' ? s.rect.width / ITEM_MM.envelope.w : far;
      if (s.item.kind === 'envelope' && s !== slots[0]) {
        const closed = recordEnvelopeStock(s.item.paper, s.item.liner, k, itemSeed(seed, s.item.id), false, pixelRatio);
        placeItem(c, closed, { ...s.rect, height: ITEM_MM.envelopeClosed.h * k }, s.rotation);
        continue;
      }
      placeItem(c, itemPicture(s.item, k, seed, 0, pixelRatio), s.rect, s.rotation);
    }
    c.restore();

    // Far below the desk top and in its shade: the floor and everything on it a grade darker and a touch
    // cooler than the top (so the eye reads them as far, not small).
    const grade = fill(rgba(0.86, 0.875, 0.92, 1));
    grade.setBlendMode(BlendMode.Multiply);
    c.drawRect(Skia.XYWHRect(floor.x, floor.y, floor.width, floor.height), grade);

    // Light inside the box: the desk edge's shadow at the back (50 % → 0 over 32 pt), the left wall's
    // shadow (the lamp is to the left), a little occlusion along the right wall and the front's foot.
    const back = EDGE_SHADOW.depth;
    gradient(c, { x: floor.x, y: 0, width: floor.width, height: back }, { x: 0, y: 0 }, { x: 0, y: back }, [
      rgba(0.02, 0.01, 0.005, EDGE_SHADOW.alpha),
      rgba(0.02, 0.01, 0.005, 0),
    ]);
    gradient(
      c,
      { x: floor.x, y: 0, width: 12, height: H },
      { x: floor.x, y: 0 },
      { x: floor.x + 12, y: 0 },
      [rgba(0.02, 0.01, 0.005, 0.34), rgba(0.02, 0.01, 0.005, 0.12), rgba(0, 0, 0, 0)],
      [0, 0.4, 1],
    );
    gradient(c, { x: W - wall - 4, y: 0, width: 4, height: H }, { x: W - wall, y: 0 }, { x: W - wall - 4, y: 0 }, [
      rgba(0, 0, 0, 0.22),
      rgba(0, 0, 0, 0),
    ]);
    gradient(c, { x: floor.x, y: H - 6, width: floor.width, height: 6 }, { x: 0, y: H }, { x: 0, y: H - 6 }, [
      rgba(0, 0, 0, 0.26),
      rgba(0, 0, 0, 0),
    ]);

    // The side walls' top edges: each one board of the drawer's own bare oak, its grain running along it
    // (the wood drawn turned a quarter, in its own frame: x down the wall), lit on the lamp side.
    const sideBoard: WoodSpec = { ...P.interior, boards: 1 };
    for (const x of [0, W - wall]) {
      c.save();
      c.translate(x + wall, 0);
      c.rotate(90, 0, 0);
      drawWood(c, sideBoard, { x: 0, y: 0, width: H, height: wall }, subSeed(seed, `wall.${drawer}.${x}`), far, false, {
        x: inside.y,
        y: x + wall - inside.x,
        h: inside.h,
      });
      c.restore();
      c.drawRect(Skia.XYWHRect(x, 0, 0.8, H), fill(rgba(1, 0.92, 0.78, 0.22)));
      c.drawRect(Skia.XYWHRect(x + wall - 0.8, 0, 0.8, H), fill(rgba(0, 0, 0, 0.3)));
    }
    gradient(c, { x: 0, y: 0, width: W, height: 30 }, { x: 0, y: 0 }, { x: 0, y: 30 }, [
      rgba(0.02, 0.01, 0.005, 0.45),
      rgba(0.02, 0.01, 0.005, 0),
    ]);
    const up = slots.find((s) => s.item.id === lifted && !(s.inUse && (s.item.kind === 'pen' || s.item.kind === 'ink')));
    if (up) {
      // Carried height: scale 1.05 and a wider, softer shadow under it (dy 12, blur 20, 25 %).
      const r = { ...up.rect, x: up.rect.x + wall };
      c.save();
      c.translate(-LIGHT_DIR.x * 7, 12);
      c.drawRect(Skia.XYWHRect(r.x, r.y, r.width, r.height), blurred(rgba(0.04, 0.02, 0.01, 0.25), 10));
      c.restore();
      const k = up.item.kind === 'envelope' ? up.rect.width / ITEM_MM.envelope.w : far;
      placeItem(c, itemPicture(up.item, k, seed, 0, pixelRatio), r, up.rotation, 1.05);
    }
    // The front board's top edge, seen from above, then its face.
    const rim = Math.max(3, 4 * frontK(layout));
    drawWood(
      c,
      faceWood(preset),
      { x: 0, y: H - rim, width: W, height: rim },
      subSeed(frontSeed(seed, drawer), 'rim'),
      far,
      false,
      lampIn(lamp, { x: f.x, y: f.y - rim }),
    );
    c.drawRect(Skia.XYWHRect(0, H - rim, W, 0.8), fill(rgba(1, 0.9, 0.75, 0.22)));
    c.drawRect(Skia.XYWHRect(0, H - 0.8, W, 0.8), fill(rgba(0, 0, 0, 0.35)));
    c.save();
    c.translate(0, H);
    drawFront(c, W, f.height, preset, frontSeed(seed, drawer), far, lampIn(lamp, f));
    c.restore();
  });
}

// ---------------------------------------------------------------- the desk top

/** The underlay's height for this content: rounded up to 200 pt, so a new row of buttons doesn't redraw it. */
/**
 * The desk top's height: the content's, rounded up to 200 pt with at least 120 pt to spare, so a row of
 * buttons appearing under the sheet (the first word typed, a second sheet) doesn't draw the wood again.
 */
export const underlayHeight = (contentHeight: number) => Math.max(200, Math.ceil((contentHeight + 120) / 200) * 200);

/**
 * The desk top under the scroll content (content coordinates, `height` tall): wood over all of it, worn
 * along its bottom (the desk's near edge); the sous-main around the sheet with its own shadow; the sheet's
 * contact shadow on the leather; on a laptop with room beside the pad, the paper, pen, bottle and envelope
 * in use lying there at near scale.
 */
export function recordUnderlay(
  layout: DeskLayout,
  preset: Country,
  seed: number,
  sheetRect: Rect | null,
  height: number,
  resting: RestingLook | null,
): SkPicture {
  const P = DESK_PRESETS[preset];
  const W = layout.width;
  const near = layout.near;
  const sheet = sheetRect ?? { ...estimatedSheet(layout), y: estimatedSheet(layout).y - layout.insets.top };
  const lamp = deskLamp(sheet);
  return record({ x: 0, y: 0, width: W, height }, (c) => {
    drawWood(c, preset, { x: 0, y: 0, width: W, height }, subSeed(seed, 'top'), near, false, lamp, height);

    // The sous-main: leather over a ~3 mm board, lifted a little off the wood.
    const pad = padRectFor(layout, sheet);
    // On a phone it runs off both sides: its side edges (and fillets) stay off screen.
    const shaderRect: Rect = layout.pad.fullBleed ? { ...pad, x: -40, width: W + 80 } : pad;
    const r = layout.pad.radius;
    const padPath = Skia.PathBuilder.Make()
      .addRRect(Skia.RRectXY(Skia.XYWHRect(shaderRect.x, shaderRect.y, shaderRect.width, shaderRect.height), r, r))
      .detach();
    dropShadow(c, padPath, 1.6 * near, 0.4);
    const fillets = P.doubleFillet ? layout.pad.fillets : layout.pad.fillets.slice(0, 1);
    const p = Skia.Paint();
    p.setAntiAlias(true);
    p.setShader(
      effects().leather.makeShader(
        leatherUniforms(P.leather, shaderRect, subSeed(seed, 'leather'), near, {
          fillets,
          gilt: P.gilt,
          radius: r,
          lamp: lampIn(lamp, shaderRect),
          rest: { x: sheet.x + sheet.width * 0.8 - shaderRect.x, y: sheet.y + sheet.height * 0.88 - shaderRect.y },
        }),
      ),
    );
    c.save();
    c.translate(shaderRect.x, shaderRect.y);
    c.drawRect(Skia.XYWHRect(0, 0, shaderRect.width, shaderRect.height), p);
    c.restore();

    // The sheet's contact shadow on the leather (dy 6, blur 10, 35 %; a tight 1 pt one).
    if (sheetRect) {
      const s = Skia.XYWHRect(sheetRect.x, sheetRect.y, sheetRect.width, sheetRect.height);
      c.save();
      c.translate(2, 6);
      c.drawRect(s, blurred(rgba(0.08, 0.05, 0.016, 0.35), 5));
      c.restore();
      c.save();
      c.translate(0, 1);
      c.drawRect(s, blurred(rgba(0.08, 0.05, 0.016, 0.4), 0.75));
      c.restore();
    }

    // The laptop's resting items, at near scale (drawn here for a still frame; the scene draws them on
    // their own layer, `recordResting`, so they can fade while a drawer is open).
    if (resting) drawResting(c, layout, seed, sheet, resting);
  });
}

function drawResting(c: SkCanvas, layout: DeskLayout, seed: number, sheet: Rect, resting: RestingLook) {
  const places = restingPlaces(layout, sheet);
  if (!places) return;
  const put = (picture: SkPicture, at: { x: number; y: number; rotation: number }, w: number, h: number) =>
    placeItem(c, picture, { x: at.x - w / 2, y: at.y - h / 2, width: w, height: h }, at.rotation);
  const s = layout.near;
  const id = (k: string) => subSeed(seed, `resting.${k}`);
  put(
    recordPaperStack(resting.paper as SheetPaper, s, id('paper'), ITEM_MM.supply),
    places.paper,
    ITEM_MM.supply.w * s,
    ITEM_MM.supply.h * s,
  );
  put(
    recordEnvelopeStock(resting.envelope.paper, resting.envelope.liner, s, id('envelope'), false),
    places.envelope,
    ITEM_MM.envelopeClosed.w * s,
    ITEM_MM.envelopeClosed.h * s,
  );
  put(recordBottle(resting.ink, s, id('bottle')), places.bottle, ITEM_MM.bottle * s, ITEM_MM.bottle * s);
  put(
    recordPen(resting.pen, s, true, places.pen.rotation, resting.ink),
    places.pen,
    PENS[resting.pen].lengthMm * s,
    ITEM_MM.penDiameter[resting.pen] * s,
  );
}

/**
 * The laptop's resting items alone (content coordinates, transparent elsewhere): their own layer over the
 * desk top, faded while a drawer is open so the drawer's far-scale stock isn't read against them.
 */
export function recordResting(
  layout: DeskLayout,
  seed: number,
  sheetRect: Rect | null,
  height: number,
  resting: RestingLook,
): SkPicture {
  const sheet = sheetRect ?? { ...estimatedSheet(layout), y: estimatedSheet(layout).y - layout.insets.top };
  return record({ x: 0, y: 0, width: layout.width, height }, (c) => drawResting(c, layout, seed, sheet, resting));
}
