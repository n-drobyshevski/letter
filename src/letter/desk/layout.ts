import { useMemo } from 'react';

import {
  DRAWERS,
  type DeskBand,
  type DeskLayout,
  type DeskLayoutInput,
  type DrawerGeometry,
  type DrawerKey,
  type PadRule,
  type Placement,
  type Rect,
  type RestingPlaces,
} from './types';

/**
 * The desk's geometry (spec §2.2, §2.3, §3.2): phone or laptop, the fixed band, the three fronts,
 * each drawer's travel, depth and pan, the scales, the sous-main rule and the sheet size.
 * Pure, no React Native at module level, so node tests can check it at every QA viewport
 * (`useDeskLayout` requires React Native lazily, inside the hook).
 */

/** Windows at least this wide get the laptop desk. */
export const LAPTOP_MIN_WIDTH = 900;
/** Drawer side walls (pt): the interior is the front's width minus two walls. */
export const DRAWER_WALL = 5;
/** Margin (pt) between an interior's back or front and the first or last item. */
export const DRAWER_MARGIN = 8;
/** The smallest stagger (pt) between stacked items: a back item's visible strip is at least a hit area tall. */
export const MIN_STAGGER = 22;

/** Item sizes in mm (real): what the slots are laid out from, and what the recorders draw. */
export const ITEM_MM = {
  /** A5 paper stack. */
  stack: { w: 148, h: 210 },
  /** C6 envelope, back up, its closing flap open and laid back (114 + 40 mm). */
  envelope: { w: 162, h: 154 },
  /** C6 envelope, flap closed (the laptop's resting one). */
  envelopeClosed: { w: 162, h: 114 },
  /** A6-cropped paper supply on the laptop desk. */
  supply: { w: 105, h: 148 },
  /** Square ink bottle. */
  bottle: 40,
  /** Pen barrels' diameters (their lengths are `PENS[k].lengthMm`). */
  penDiameter: { fine: 13, broad: 14, glass: 10 },
} as const;

/** The longest pen (mm), for the resting pen's column. */
const LONGEST_PEN_MM = 160;

const SQRT2 = Math.SQRT2;

type Mode = DeskLayout['mode'];

/** Band rows (pt, without the bottom inset). */
const BAND: Record<Mode, { nosing: number; fronts: number; rail: number; knee: number }> = {
  phone: { nosing: 6, fronts: 44, rail: 4, knee: 12 },
  laptop: { nosing: 8, fronts: 54, rail: 6, knee: 16 },
};

/** Front travel D and nominal interior depths H (§3.2). */
const TRAVEL: Record<Mode, number> = { phone: 96, laptop: 120 };
const DEPTH: Record<Mode, Record<DrawerKey, number>> = {
  phone: { paper: 352, pens: 150, envelopes: 312 },
  laptop: { paper: 444, pens: 210, envelopes: 432 },
};
const FAR: Record<Mode, number> = { phone: 0.68, laptop: 1.0 };

/** Laptop fronts, left to right. */
const LAPTOP_FRONTS: Record<DrawerKey, number> = { paper: 220, pens: 260, envelopes: 220 };
/** The rails (stiles) between fronts. */
export const FRONT_GAP: Record<Mode, number> = { phone: 4, laptop: 8 };

/**
 * Laptop: what sits above the sous-main (§2.3): top gap, title, gap, hint, gap, the mode row, and 4 pt
 * to the pad's top edge (the scene starts the pad below the header); and the gap left between the
 * sheet's foot and the band (the pad's lower margin may run under the desk's near edge).
 */
const LAPTOP_HEADER = 12 + 34 + 12 + 18 + 12 + 28 + 4;
const LAPTOP_FOOT = 12;
/** The sous-main's margin above and below the sheet (pt): 24 on a phone, 28 on a laptop. */
const PAD_MARGIN_Y: Record<Mode, number> = { phone: 24, laptop: 28 };

/** Pen rows' pitch (pt) in the pen drawer. */
export const PEN_ROW: Record<Mode, number> = { phone: 22, laptop: 30 };

/** The tallest a drawer may be pulled: its desk edge at t = 1 stays this far below the top inset. */
const TOP_CLEARANCE = 40;

/** The smallest interior that still holds every item at its real size (only the stagger shrinks). */
function minDepth(drawer: DrawerKey, mode: Mode, far: number): number {
  const m = 2 * DRAWER_MARGIN;
  if (drawer === 'paper') return m + ITEM_MM.stack.h * far + 3 * MIN_STAGGER;
  if (drawer === 'envelopes') return m + ITEM_MM.envelope.h * far + 5 * MIN_STAGGER;
  // Pens: three rows, a gap, then a bottle row with a 44 pt hit area.
  return m + 3 * PEN_ROW[mode] + DRAWER_MARGIN + Math.max(44, ITEM_MM.bottle * far + 16);
}

/** The sheet: `useSheetSize()` on a phone; on a laptop capped so the header, the pad above it, the sheet and the band fit the window (§2.3). */
function sheetSize(mode: Mode, width: number, height: number, top: number, band: number) {
  const maxHeight = mode === 'laptop' ? height - top - LAPTOP_HEADER - PAD_MARGIN_Y.laptop - LAPTOP_FOOT - band : Infinity;
  const capped = Number.isFinite(maxHeight) ? Math.floor(Math.max(0, maxHeight) / SQRT2) : Infinity;
  const w = Math.max(160, Math.round(Math.min(width - 32, 520, capped)));
  return { width: w, height: Math.round(w * SQRT2) };
}

/** Everything the scene needs to lay out the desk for this window. */
export function deskLayout(input: DeskLayoutInput): DeskLayout {
  const { width, height } = input;
  const insets = {
    top: input.insets.top,
    bottom: input.insets.bottom,
    left: input.insets.left ?? 0,
    right: input.insets.right ?? 0,
  };
  const mode: Mode = width >= LAPTOP_MIN_WIDTH ? 'laptop' : 'phone';
  const rows = BAND[mode];
  const bandHeight = rows.nosing + rows.fronts + rows.rail + rows.knee + insets.bottom;
  const band: DeskBand = { top: height - bandHeight, height: bandHeight, ...rows, inset: insets.bottom };
  const frontY = band.top + rows.nosing;

  // Fronts: full bleed on a phone (4 pt rails between, none at the edges), centred on a laptop.
  const gap = FRONT_GAP[mode];
  let widths: Record<DrawerKey, number>;
  let x0: number;
  if (mode === 'phone') {
    const side = Math.round(0.325 * (width - 2 * gap));
    widths = { paper: side, pens: width - 2 * gap - 2 * side, envelopes: side };
    x0 = 0;
  } else {
    widths = LAPTOP_FRONTS;
    x0 = (width - (widths.paper + widths.pens + widths.envelopes + 2 * gap)) / 2;
  }
  const fronts = {} as Record<DrawerKey, Rect>;
  let x = x0;
  for (const key of DRAWERS) {
    fronts[key] = { x, y: frontY, width: widths[key], height: rows.fronts };
    x += widths[key] + gap;
  }

  // Drawers: H clamped so the desk edge (band top − C) stays below insets.top + 40; never below what the items need.
  const far = FAR[mode];
  const travel = TRAVEL[mode];
  const maxDepth = band.top - travel - (insets.top + TOP_CLEARANCE);
  const drawers = {} as Record<DrawerKey, DrawerGeometry>;
  for (const key of DRAWERS) {
    const depth = Math.max(minDepth(key, mode, far), Math.min(DEPTH[mode][key], maxDepth));
    drawers[key] = {
      travel,
      depth,
      pan: depth + travel,
      interior: { width: widths[key] - 2 * DRAWER_WALL, height: depth },
    };
  }

  const sheet = sheetSize(mode, width, height, insets.top, bandHeight);
  const pad: PadRule =
    mode === 'phone'
      ? { fullBleed: true, marginX: 0, marginY: PAD_MARGIN_Y.phone, fillets: [8], radius: 3 }
      : {
          fullBleed: false,
          marginX: Math.max(22, 0.12 * sheet.width),
          marginY: PAD_MARGIN_Y.laptop,
          fillets: [12, 15],
          radius: 3,
        };
  const sideSpace = (width - (sheet.width + 2 * pad.marginX)) / 2;

  return {
    mode,
    width,
    height,
    insets,
    near: sheet.width / 150,
    far,
    sheet,
    band,
    fronts,
    drawers,
    pad,
    resting: mode === 'laptop' && sideSpace >= 300 ? 'sides' : 'none',
  };
}

/** `deskLayout` for the current window (`useWindowDimensions`) and safe area (`useSafeAreaInsets`). */
export function useDeskLayout(): DeskLayout {
  // Required here, not imported, so node tests can load this module (React Native doesn't parse in node).
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { useWindowDimensions } = require('react-native') as typeof import('react-native');
  const { useSafeAreaInsets } = require('react-native-safe-area-context') as typeof import('react-native-safe-area-context');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const { width, height } = useWindowDimensions();
  const { top, bottom, left, right } = useSafeAreaInsets();
  return useMemo(
    () => deskLayout({ width, height, insets: { top, bottom, left, right } }),
    [width, height, top, bottom, left, right],
  );
}

/** The sous-main around the measured sheet: full bleed on a phone, the sheet plus margins on a laptop. */
export function padRectFor(layout: DeskLayout, sheet: Rect): Rect {
  const { pad } = layout;
  const y = sheet.y - pad.marginY;
  const height = sheet.height + 2 * pad.marginY;
  // Full bleed: the side edges (and their rounded corners) run off the screen.
  if (pad.fullBleed) return { x: -2 * pad.radius, y, width: layout.width + 4 * pad.radius, height };
  return { x: sheet.x - pad.marginX, y, width: sheet.width + 2 * pad.marginX, height };
}

/**
 * Where the laptop's resting items lie beside the pad (§2.3), or null when `layout.resting` is 'none'.
 * Same coordinates as `sheet` (the scroll content). Rotations are clockwise radians applied to the item
 * as it lies in its drawer slot (a pen horizontal with its nib to the right, +x).
 */
export function restingPlaces(layout: DeskLayout, sheet: Rect): RestingPlaces | null {
  if (layout.resting === 'none') return null;
  const s = layout.near;
  const pad = padRectFor(layout, sheet);
  const padRight = pad.x + pad.width;

  // The paper supply: left of the pad, at least 24 pt from it, up to 40 % off the left edge.
  const supplyW = ITEM_MM.supply.w * s;
  const supplyH = ITEM_MM.supply.h * s;
  const paperX = Math.min(pad.x - 24 - supplyW / 2, 0.1 * supplyW);
  const paper: Placement = {
    x: paperX,
    y: sheet.y + 0.12 * sheet.height + supplyH / 2,
    rotation: (-3 * Math.PI) / 180,
    scale: s,
  };

  // The pen: right of the pad, nib toward the sheet (up and left), 30° off vertical, its centre 0.62 h down.
  // Its column clears the longest pen's half-width across (L · sin 30° / 2) plus 24 pt.
  const penX = padRight + 24 + (LONGEST_PEN_MM * s) / 4;
  const pen: Placement = { x: penX, y: sheet.y + 0.62 * sheet.height, rotation: (-2 * Math.PI) / 3, scale: s };

  // The bottle stands above the pen, 0.2 h down, barely turned.
  const bottle: Placement = { x: penX, y: sheet.y + 0.2 * sheet.height, rotation: (4 * Math.PI) / 180, scale: s };

  // The envelope: bottom right, turned 6°, half off the right edge.
  const envH = ITEM_MM.envelopeClosed.h * s;
  const envelope: Placement = {
    x: layout.width,
    y: sheet.y + sheet.height - envH * 0.3,
    rotation: (6 * Math.PI) / 180,
    scale: s,
  };

  return { paper, pen, bottle, envelope };
}
