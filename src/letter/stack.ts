import { mulberry32, subSeed, wobble } from '../lib/random';
import type { PaperKind } from '../theme/stationery';
import type { FoldKind } from './fold';
import type { Side } from './paperLayout';
import type { Stroke, StrokePoint } from './strokes';

/**
 * A letter is a small stack of sheets, each with a front (recto) and a back (verso).
 * Each face holds its own text and pen strokes: nothing flows between faces.
 * Read in the order it was written: sheet 1 recto, its verso (if written), sheet 2…
 * Pure (no Skia) so it can be tested in node.
 */

export type FaceContent = { text: string; strokes: Stroke[] };
export type SheetContent = {
  recto: FaceContent;
  verso: FaceContent;
  /** The writer's choice for this sheet: write on the back too, or keep it blank. */
  twoSided: boolean;
};
export type FaceRef = { sheet: number; side: Side };

/** A real envelope takes about four folded sheets; folded in four, two. */
export const MAX_SHEETS = 4;
export const maxSheetsFor = (fold: FoldKind | undefined) => (fold === 'quarter' ? 2 : MAX_SHEETS);

/**
 * The desk's controls for a second side and more sheets. A reader older than this
 * shows only page 1 of a longer letter: turn it off if a build that can't read
 * sheets is still on one of the two phones.
 */
export const MULTI_SHEET = true;

/** Windows at least this wide (web) lay the sheets loose on the desk instead of in a stack. */
export const LOOSE_MIN_WIDTH = 760;

/**
 * The loose desk's area for a sheet of this size: as tall as the sheet's diagonal (and a
 * little), so a sheet at any angle lies between the page's header and its buttons; the top
 * sheet's home is its centre.
 */
export const looseAreaOf = (width: number, height: number, screenW: number) => ({
  width: Math.max(width, Math.min(screenW - 32, Math.round(width * 2.15))),
  height: Math.ceil(Math.hypot(width, height)) + 24,
});

// Paper that is written on both sides by habit: the thin school notebook leaf, the copie double, airmail onion skin (postage).
const TWO_SIDED: Record<PaperKind, boolean> = { grid: true, cotton: false, seyes: true, airmail: true, cream: false, kraft: false };
export const defaultTwoSided = (paper: PaperKind) => TWO_SIDED[paper];

export const emptyFace = (): FaceContent => ({ text: '', strokes: [] });
export const emptySheet = (paper: PaperKind): SheetContent => ({ recto: emptyFace(), verso: emptyFace(), twoSided: defaultTwoSided(paper) });
export const isEmptyFace = (f: FaceContent | undefined) => !f || (f.text.trim() === '' && f.strokes.length === 0);
export const isEmptySheet = (s: SheetContent) => isEmptyFace(s.recto) && isEmptyFace(s.verso);

/** The stack without trailing blank sheets (a sheet taken but never written stays on the desk); at least one. */
export function trimSheets(sheets: SheetContent[]): SheetContent[] {
  let n = sheets.length;
  while (n > 1 && isEmptySheet(sheets[n - 1])) n--;
  return sheets.slice(0, n);
}

export const faceOf = (sheets: SheetContent[], ref: FaceRef): FaceContent => sheets[ref.sheet]?.[ref.side] ?? emptyFace();
export const faceIndex = (ref: FaceRef) => ref.sheet * 2 + (ref.side === 'verso' ? 1 : 0);

/**
 * A face the stack actually has: the sheet clamped to the stack, and the recto of a sheet that is not
 * (or no longer) two-sided. The same object when it already is one, so callers can compare.
 */
export function clampFace(ref: FaceRef, sheets: SheetContent[]): FaceRef {
  const sheet = Math.max(0, Math.min(sheets.length - 1, ref.sheet));
  const side = ref.side === 'verso' && sheets[sheet]?.twoSided ? 'verso' : 'recto';
  return sheet === ref.sheet && side === ref.side ? ref : { sheet, side };
}

/**
 * Pen strokes are in pixels of the sheet they were drawn on: scaled by `k` when the sheet changes
 * width (a resized window). The same array when there is nothing to scale.
 */
export function rescaleStrokes(sheets: SheetContent[], k: number): SheetContent[] {
  if (k === 1 || !Number.isFinite(k) || k <= 0) return sheets;
  if (sheets.every((s) => s.recto.strokes.length === 0 && s.verso.strokes.length === 0)) return sheets;
  const face = (f: FaceContent): FaceContent => ({ ...f, strokes: f.strokes.map((s) => s.map(([x, y, p, t]): StrokePoint => [x * k, y * k, p, t])) });
  return sheets.map((s) => ({ ...s, recto: face(s.recto), verso: face(s.verso) }));
}

/** A copy of `sheets` with one face replaced. */
export function withFace(sheets: SheetContent[], ref: FaceRef, face: FaceContent): SheetContent[] {
  return sheets.map((s, i) => (i === ref.sheet ? { ...s, [ref.side]: face } : s));
}

/**
 * The faces a reader goes through, in order. Every recto (even blank: it is a sheet
 * in the stack), and a verso only when something is written on it.
 */
export function writtenFaces(sheets: SheetContent[]): FaceRef[] {
  const faces: FaceRef[] = [];
  sheets.forEach((s, sheet) => {
    faces.push({ sheet, side: 'recto' });
    if (!isEmptyFace(s.verso)) faces.push({ sheet, side: 'verso' });
  });
  return faces;
}

/**
 * Seeds. Sheet 1 recto keeps the letter's own seed (so one-sheet letters look as
 * they always did); every other sheet has its own pulp and every face its own hand.
 * Creases use the letter seed for the whole stack: the sheets were folded together.
 */
export const paperSeed = (seed: number, sheet: number) => (sheet === 0 ? seed : subSeed(seed, `sheet${sheet}`));
export const inkSeed = (seed: number, ref: FaceRef) => {
  const k = faceIndex(ref);
  return k === 0 ? seed : subSeed(seed, `face${k}`);
};

// Thickness of one sheet (mm): thin notebook paper, heavier cotton writing paper, 90 g Seyès, 35 g onion skin.
const CALIPER_MM: Record<PaperKind, number> = { grid: 0.075, cotton: 0.13, seyes: 0.11, airmail: 0.045, cream: 0.11, kraft: 0.12 };
// Layers of paper per sheet once folded.
const LAYERS: Record<FoldKind, number> = { tri: 3, half: 2, quarter: 4 };

/** How thick the folded letter is (mm): layers × caliper, plus the air each crease traps. */
export const packetMm = (fold: FoldKind, sheets: number, paper: PaperKind) => LAYERS[fold] * sheets * CALIPER_MM[paper] * 1.3;

/**
 * How much the envelope bulges, 0..1. A sheet or two lies flat (under ~0.7 mm);
 * four sheets of cotton folded in three (~2 mm) round it out almost fully.
 */
export const bulgeFor = (fold: FoldKind, sheets: number, paper: PaperKind) =>
  Math.min(1, Math.max(0, (packetMm(fold, sheets, paper) - 0.7) / 1.5));

/** Sheets in a stack never line up exactly: a small seeded offset and skew for each one under the top. */
export function sheetJitter(seed: number, sheet: number): { dx: number; dy: number; rot: number } {
  if (sheet === 0) return { dx: 0, dy: 0, rot: 0 };
  const rand = mulberry32(subSeed(seed, `stack${sheet}`));
  return { dx: wobble(rand, 1.5), dy: wobble(rand, 1.5), rot: wobble(rand, (0.5 * Math.PI) / 180) };
}

/** Stored strokes are rounded (0.1 px, pressure to 0.01, whole ms): about half the JSON, no visible change. */
export function quantizeStroke(stroke: Stroke): Stroke {
  return stroke.map(([x, y, p, t]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100, Math.round(t)]);
}
