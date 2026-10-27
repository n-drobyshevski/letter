import { LIGHT_DIR } from '../paperLayout';
import type { Country, Rgb } from '../../theme/stationery';
import type { DeskLayout, Rect } from './types';

/**
 * The desk's presets and the uniform builders for WOOD_SKSL and LEATHER_SKSL (spec §5.4).
 * Skia-free, so node tests build exactly what the app draws.
 *
 * One desk per writer's country:
 * - **fr**: French-polished walnut, an oxblood leather sous-main with a double gilt fillet (single on a
 *   phone), brass bail pulls, oak-lined drawers;
 * - **ru**: dark-stained, polished oak (half the arch contrast of raw oak, pores at half strength),
 *   a bottle-green sous-main with a single fillet, brass knob pulls, birch-lined drawers.
 * The pen tray is felt in both.
 */

/** sRGB hex (`#rrggbb`) as 0..1 floats. */
export function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** A finished wood: colours under the lamp, in general and far from it, its pores and its sheen; its figure. */
export type WoodSpec = {
  lit: Rgb;
  base: Rgb;
  shadow: Rgb;
  pore: Rgb;
  sheen: Rgb;
  /** Mean ring width, mm. */
  ringMm: number;
  /** Contrast of the rings (the flat-sawn arches), 0..1. */
  arch: number;
  /** Oak ray flecks (> 0 also means ring-porous oak pores); 0 for walnut. */
  rays: number;
  /** Boards across a 600 mm deep top. */
  boards: number;
};

export type DeskPreset = {
  wood: WoodSpec;
  /** Bare wood inside the drawers (paper and envelopes). */
  interior: WoodSpec;
  /** The deepest shade under the apron (the old `DESK.wood`). */
  deep: string;
  leather: Rgb;
  gilt: Rgb;
  /** Two gilt fillets on a laptop's pad (the phone's has one). */
  doubleFillet: boolean;
  pull: 'bail' | 'knob';
  brass: { lit: Rgb; shade: Rgb };
  /** The pen tray's felt. */
  felt: Rgb;
  /** The brass card holder's card and its handwritten label (an RN Text over the card). */
  card: string;
  label: string;
};

/** Bare, unfinished wood from one colour: no sheen, a soft lamp (it is in the drawer's shade anyway). */
function bareWood(hex: string, ringMm: number, rays: number): WoodSpec {
  const c = rgb(hex);
  const k = (f: number): Rgb => [c[0] * f, c[1] * f, c[2] * f];
  return { lit: k(1.08), base: c, shadow: k(0.72), pore: k(0.78), sheen: k(1.12), ringMm, arch: 0.35, rays, boards: 4 };
}

export const DESK_PRESETS: Record<Country, DeskPreset> = {
  fr: {
    wood: {
      lit: rgb('#6d4e3a'),
      base: rgb('#563d2f'),
      shadow: rgb('#36271f'),
      pore: rgb('#423128'),
      sheen: rgb('#8c6c51'),
      ringMm: 4,
      arch: 0.6,
      rays: 0,
      boards: 3,
    },
    interior: bareWood('#ad9173', 1.8, 0.25),
    deep: '#3a2c22',
    // Oxblood: the reference is #5d292d as seen under the lamp; the lamp lifts the pad's median ~20 %.
    leather: rgb('#4e2428'),
    gilt: rgb('#b5904e'),
    doubleFillet: true,
    pull: 'bail',
    brass: { lit: rgb('#ac8c4d'), shade: rgb('#644f2f') },
    felt: rgb('#345444'),
    card: '#efe2cc',
    label: '#3a2c22',
  },
  ru: {
    wood: {
      lit: rgb('#7b5a3f'),
      base: rgb('#5f4431'),
      shadow: rgb('#3b2a1f'),
      pore: rgb('#3a2a20'),
      sheen: rgb('#93745a'),
      ringMm: 2,
      arch: 0.3,
      rays: 0.35,
      boards: 4,
    },
    interior: bareWood('#b09474', 1.6, 0),
    deep: '#3a2c22',
    // Bottle green: #344c3a as seen under the lamp (the lamp lifts the pad's median, its green the most).
    leather: rgb('#314134'),
    gilt: rgb('#a88a4f'),
    doubleFillet: false,
    pull: 'knob',
    brass: { lit: rgb('#ac8c4d'), shade: rgb('#644f2f') },
    felt: rgb('#345444'),
    card: '#efe2cc',
    label: '#3a2c22',
  },
};

/** The desk lamp: where its hotspot is (pt) and how high it hangs (pt): it sets how fast the light falls off. */
export type Lamp = { x: number; y: number; h: number };

/** The lamp over the sheet's upper-left third (spec §2.1), as high as the sheet is wide: the header stays darker. */
export function deskLamp(sheet: Rect): Lamp {
  return { x: sheet.x + sheet.width * 0.34, y: sheet.y + sheet.height * 0.3, h: sheet.width * 1.1 };
}

/** Where the sheet sits on screen (pt) before it is measured: centred, under the title, hint and controls. */
export function estimatedSheet(layout: DeskLayout): Rect {
  const top = layout.insets.top + (layout.mode === 'phone' ? 150 : 88);
  return { x: (layout.width - layout.sheet.width) / 2, y: top, width: layout.sheet.width, height: layout.sheet.height };
}

/** The lamp in a canvas's own coordinates (the canvas's top-left at `origin`). */
export const lampIn = (lamp: Lamp, origin: { x: number; y: number }): Lamp => ({
  x: lamp.x - origin.x,
  y: lamp.y - origin.y,
  h: lamp.h,
});

const woodOf = (preset: Country | WoodSpec): WoodSpec => (typeof preset === 'string' ? DESK_PRESETS[preset].wood : preset);

/**
 * WOOD_SKSL's uniforms, in declaration order. `size` is the canvas region (pt), `scale` pt per mm,
 * `face` a vertical face (apron, fronts), `lamp` in this canvas's coordinates, `wearY` the desk's near
 * edge (a worn band above it), or undefined for none.
 */
export function woodUniforms(
  preset: Country | WoodSpec,
  size: { width: number; height: number },
  seed: number,
  scale: number,
  face: boolean,
  lamp: Lamp,
  wearY?: number,
): number[] {
  const w = woodOf(preset);
  return [
    size.width,
    size.height,
    seed % 9973,
    scale,
    ...w.lit,
    ...w.base,
    ...w.shadow,
    ...w.pore,
    ...w.sheen,
    w.ringMm,
    w.arch,
    w.rays,
    w.boards,
    lamp.x,
    lamp.y,
    lamp.h,
    LIGHT_DIR.x,
    LIGHT_DIR.y,
    face ? 1 : 0,
    wearY ?? -1,
  ];
}

export type LeatherOptions = {
  /** Gilt fillet insets (pt): up to two; none for felt. */
  fillets?: readonly number[];
  gilt?: Rgb;
  radius?: number;
  felt?: boolean;
  lamp: Lamp;
  /** Where the writing hand rests (pt, pad-local); default: lower right of the pad. */
  rest?: { x: number; y: number };
};

/** LEATHER_SKSL's uniforms, in declaration order, for a pad of `size` (pt) drawn at its own (0, 0). */
export function leatherUniforms(
  color: Rgb,
  size: { width: number; height: number },
  seed: number,
  scale: number,
  o: LeatherOptions,
): number[] {
  const f = o.fillets ?? [];
  const rest = o.rest ?? { x: size.width * 0.62, y: size.height * 0.74 };
  return [
    size.width,
    size.height,
    (seed % 997) * 1.37,
    scale,
    ...color,
    ...(o.gilt ?? [0.7, 0.55, 0.3]),
    f[0] ?? 0,
    f[1] ?? 0,
    o.radius ?? 3,
    o.felt ? 1 : 0,
    o.lamp.x,
    o.lamp.y,
    o.lamp.h,
    LIGHT_DIR.x,
    LIGHT_DIR.y,
    rest.x,
    rest.y,
  ];
}
