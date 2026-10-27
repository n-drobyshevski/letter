import { hashString, mulberry32, wobble } from '../../lib/random';
import { NEW_STATIONERY } from '../../theme/kinds';
import { DRAWER_MARGIN, DRAWER_WALL, ITEM_MM, PEN_ROW } from './layout';
import { itemsFor, PENS, type DeskItem, type DeskLayout, type DrawerKey, type InUse, type Rect, type Slot } from './types';

/**
 * Where each item lies inside an open drawer (spec §3.1): rects, hit areas and caption anchors in
 * interior coordinates (origin at the interior's top-left; the drawer's front is at the bottom).
 * Items in use keep their slot, flagged `inUse` (an empty groove, an ink ring, a pencil tick).
 *
 * - Paper and envelopes are staggered front (bottom, the first item) to back (top): each back item
 *   shows a strip as tall as the stagger, and that strip is its hit area; the front item is whole.
 * - Pens lie across the drawer, one per row, nib to the right; the bottles stand in a row at the front.
 * - Captions sit in the floor beside the box: right of the paper and pen drawers, left of the envelopes.
 *
 * Deterministic: the small jitter comes from each item's id, so the drawer box and the carry layer agree.
 */

/** Gap (pt) between the box's outer wall and a caption's anchor. */
export const CAPTION_GAP = 10;
/** Smallest hit area: one side at least 44 pt, the other at least 22 pt. */
export const HIT_MIN = { long: 44, short: 22 } as const;

const rand = (item: DeskItem) => mulberry32(hashString(item.id));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A caption anchor beside the box, in interior x: on its left (right-aligned, ending there) or its right. */
const besideLeft = () => ({ x: -DRAWER_WALL - CAPTION_GAP, align: 'right' as const });
const besideRight = (interiorWidth: number) => ({ x: interiorWidth + DRAWER_WALL + CAPTION_GAP, align: 'left' as const });

/** Where the captions go for the stacked drawers: right of the paper drawer, left of the envelopes. */
function captionX(drawer: DrawerKey, interiorWidth: number): { x: number; align: 'left' | 'right' } {
  return drawer === 'envelopes' ? besideLeft() : besideRight(interiorWidth);
}

/**
 * A seeded offset in [−max, max] that never collapses to ~0 (an average of uniforms would): its sign
 * alternates down the stack (`i`), its size is 50–100 % of the range.
 */
const spread = (r: () => number, i: number, max: number, phase = 0) => ((i + phase) % 2 ? 1 : -1) * (0.5 + 0.5 * r()) * max;

const isInUse = (item: DeskItem, inUse: InUse) => {
  switch (item.kind) {
    case 'paper':
      return item.paper === inUse.paper;
    case 'pen':
      return item.pen === inUse.pen;
    case 'ink':
      return item.ink === inUse.ink;
    case 'envelope':
      return item.paper === inUse.envelope.paper && item.liner === inUse.envelope.liner;
  }
};

/** Stacked items (paper, envelopes), front (index 0, bottom) to back (top). */
function stacked(
  drawer: DrawerKey,
  items: readonly DeskItem[],
  interior: { width: number; height: number },
  size: { w: number; h: number },
  far: number,
  inUse: InUse,
  maxTurnDeg: number,
): Slot[] {
  // Real size at far scale; only where a drawer is too narrow for it (a C6 in a phone's side drawer) is an
  // item fitted to the interior, with 4 pt to each wall so it can still lie askew.
  const fit = Math.min(1, (interior.width - 8) / (size.w * far));
  const w = size.w * far * fit;
  const h = size.h * far * fit;
  const n = items.length;
  const step = n > 1 ? Math.max(0, (interior.height - 2 * DRAWER_MARGIN - h) / (n - 1)) : 0;
  const cap = captionX(drawer, interior.width);
  return items.map((item, i) => {
    const r = rand(item);
    const slack = Math.max(0, (interior.width - w) / 2);
    // Never squared up: each one turned 0.4–1 × maxTurnDeg (its own way) and shifted ±(2–4) mm at far
    // (alternating down the stack), kept inside the walls with room for the turn.
    const turn = (spread(r, i, maxTurnDeg, r() < 0.5 ? 0 : 1) * (0.4 + 0.6 * r()) * Math.PI) / 180;
    const swing = (Math.abs(Math.sin(turn)) * h) / 2 + 1;
    const dx = clamp(spread(r, i, 4 * far), -Math.max(0, slack - swing), Math.max(0, slack - swing));
    const y = DRAWER_MARGIN + (n - 1 - i) * step;
    const rect: Rect = { x: (interior.width - w) / 2 + dx, y, width: w, height: h };
    const hit: Rect = i === 0 ? { ...rect } : { x: rect.x, y, width: w, height: step };
    return {
      item,
      rect,
      rotation: turn,
      hit,
      caption: { x: cap.x, y: hit.y + hit.height / 2, align: cap.align },
      inUse: isInUse(item, inUse),
    };
  });
}

/** The pen tray: pens in rows at the back, bottles in a row at the front. */
function penTray(
  items: readonly DeskItem[],
  interior: { width: number; height: number },
  layout: DeskLayout,
  inUse: InUse,
): Slot[] {
  const far = layout.far;
  const row = PEN_ROW[layout.mode];
  // The tray is narrow and its rows close: captions go both sides, each level with its own row. Pens
  // alternate (right, left, right), so each side has twice the row pitch; the bottles' are split by
  // column (the left pair on the left, the right pair on the right), a pair either side of their row.
  const side = (left: boolean) => (left ? besideLeft() : besideRight(interior.width));
  const pens = items.filter((i) => i.kind === 'pen');
  const bottles = items.filter((i) => i.kind === 'ink');
  const slots: Slot[] = [];

  pens.forEach((item, i) => {
    if (item.kind !== 'pen') return;
    const r = rand(item);
    const length = PENS[item.pen].lengthMm * far;
    const thick = ITEM_MM.penDiameter[item.pen] * far;
    const top = DRAWER_MARGIN + i * row;
    const slack = Math.max(0, (interior.width - length) / 2);
    const x = (interior.width - length) / 2 + clamp(wobble(r, 3 * far), -slack, slack);
    const rect: Rect = { x, y: top + (row - thick) / 2, width: length, height: thick };
    // The whole row, a little past the pen's ends, is its target.
    const hx = Math.max(0, x - 6);
    const hit: Rect = { x: hx, y: top, width: Math.min(interior.width, x + length + 6) - hx, height: row };
    slots.push({
      item,
      rect,
      rotation: 0,
      hit,
      caption: { ...side(i % 2 === 1), y: top + row / 2 },
      inUse: isInUse(item, inUse),
    });
  });

  // Bottles: one column each, standing at the front.
  const size = ITEM_MM.bottle * far;
  const n = bottles.length;
  const col = interior.width / Math.max(1, n);
  const penBottom = DRAWER_MARGIN + pens.length * row;
  const centreY = interior.height - DRAWER_MARGIN - size / 2;
  const hitH = Math.max(HIT_MIN.long, size + 16);
  const hitY = clamp(centreY - hitH / 2, penBottom, Math.max(penBottom, interior.height - hitH));
  // Captions: a pair either side, centred on the bottle row.
  const pairPitch = layout.mode === 'laptop' ? 20 : 28;
  bottles.forEach((item, i) => {
    const left = i < n / 2;
    const j = left ? i : i - Math.ceil(n / 2);
    const rect: Rect = { x: (i + 0.5) * col - size / 2, y: centreY - size / 2, width: size, height: size };
    const hit: Rect = { x: i * col, y: hitY, width: col, height: Math.min(hitH, interior.height - hitY) };
    slots.push({
      item,
      rect,
      rotation: 0,
      hit,
      caption: { ...side(left), y: centreY + (j - 0.5) * pairPitch },
      inUse: isInUse(item, inUse),
    });
  });
  return slots;
}

/**
 * The slots of one drawer for this layout. Items in use keep their slot (flagged), so nothing moves when
 * a pick changes what is on the desk.
 */
export function drawerSlots(
  drawer: DrawerKey,
  layout: DeskLayout,
  inUse: InUse,
  { newStationery = NEW_STATIONERY }: { newStationery?: boolean } = {},
): Slot[] {
  const items = itemsFor(drawer, { newStationery });
  const { interior } = layout.drawers[drawer];
  if (drawer === 'paper') return stacked(drawer, items, interior, ITEM_MM.stack, layout.far, inUse, 1);
  if (drawer === 'envelopes') return stacked(drawer, items, interior, ITEM_MM.envelope, layout.far, inUse, 1.5);
  return penTray(items, interior, layout, inUse);
}
