import { BlendMode, Canvas, Group, Picture, Rect, Shadow, Skia, type SkFont, type SkImage, type SkPicture } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { HANDWRITING_FONTS, INKS, PAPERS, type FontKey, type InkKind, type PaperKind } from '../theme/stationery';
import { layoutLetter, recordLetter, type Side } from './renderLetter';
import type { FoldKind } from './fold';
import { fontSizeFor, paperFor } from './sheet';
import { flatten } from './raster';
import { bakeGhost, mirrorPicture } from './showThrough';
import { emptyFace, inkSeed, isEmptyFace, paperSeed, type FaceContent, type FaceRef, type SheetContent } from './stack';
import { strokeToPath, type Stroke } from './strokes';
import { useSharedFont } from './useSharedFont';

export type LetterLook = {
  paper: PaperKind;
  ink: InkKind;
  font: FontKey;
  seed: number;
};

/** Which face of which sheet a bake is for (default: sheet 1's recto, the whole letter before sheets existed). */
export type FaceBake = { face?: FaceRef; ghost?: SkImage | null };

/** Bakes a letter into a Skia picture once per (text, look, size). `overflow` is true when the sheet is full. */
export function useLetterPicture(
  text: string,
  look: LetterLook,
  width: number,
  height: number,
  crease = 0,
  layers: 'all' | 'paper' | 'ink' = 'all',
  fold: FoldKind = 'tri',
  { face, ghost }: FaceBake = {},
) {
  const loaded = useSharedFont(HANDWRITING_FONTS[look.font].file, fontSizeFor(paperFor(look.paper, width), width));
  // The paper alone draws no text: it needn't wait for the font (nor be drawn again when it comes).
  const paperOnly = layers === 'paper';
  const font = paperOnly ? null : loaded;
  const sheet = face?.sheet ?? 0;
  const side = face?.side ?? 'recto';
  return useMemo(() => {
    if (!font && !paperOnly) return { picture: null, overflow: false };
    const paper = paperFor(look.paper, width);
    const input = {
      text,
      font: font as SkFont,
      paper,
      ink: INKS[look.ink].rgb,
      seed: inkSeed(look.seed, { sheet, side }),
      paperSeed: paperSeed(look.seed, sheet),
      foldSeed: look.seed,
      sheet: { width, height },
      crease,
      layers,
      fold,
      side,
      ghost,
    };
    if (paperOnly) return { picture: recordLetter(input, { words: [], lines: 0, overflowAt: -1 }), overflow: false };
    const layout = layoutLetter(input);
    return { picture: recordLetter(input, layout), overflow: layout.overflowAt >= 0 };
  }, [font, paperOnly, text, look.paper, look.ink, look.seed, width, height, crease, layers, fold, sheet, side, ghost]);
}

/**
 * Whether `text` overflows this face: the layout alone, nothing recorded (the sheet you
 * are typing on hides its ink meanwhile). Null until the font is in, or when not `enabled`.
 */
export function useLetterOverflow(text: string, look: LetterLook, width: number, height: number, face: FaceRef | undefined, enabled: boolean) {
  const font = useSharedFont(HANDWRITING_FONTS[look.font].file, fontSizeFor(paperFor(look.paper, width), width));
  const sheet = face?.sheet ?? 0;
  const side = face?.side ?? 'recto';
  return useMemo(() => {
    if (!font || !enabled) return null;
    const layout = layoutLetter({
      text,
      font,
      paper: paperFor(look.paper, width),
      ink: INKS[look.ink].rgb,
      seed: inkSeed(look.seed, { sheet, side }),
      sheet: { width, height },
      crease: 0,
      side,
    });
    return layout.overflowAt >= 0;
  }, [font, enabled, text, look.paper, look.ink, look.seed, width, height, sheet, side]);
}

/** One sheet, both faces, as the reader sees them: each with its pen strokes and the other face showing through. */
export type SheetFaces = {
  recto: SkPicture;
  verso: SkPicture;
  /** The verso in the recto's coordinates (mirrored): the back of a folded panel. */
  versoThrough: SkPicture;
};

/**
 * Bakes both faces of one sheet. Faces are laid out with a line to spare, so a face
 * filled to the bottom at the desk keeps every word at any other width.
 * Hooks are per sheet: callers bake a fixed number of sheets, never a .map().
 */
export function useSheetFaces(
  sheet: SheetContent | undefined,
  index: number,
  look: LetterLook,
  width: number,
  height: number,
  crease: number,
  fold: FoldKind,
  strokesWidth: number | undefined,
): SheetFaces | null {
  const font = useSharedFont(HANDWRITING_FONTS[look.font].file, fontSizeFor(paperFor(look.paper, width), width));
  return useMemo(
    () => (font && sheet ? bakeSheetFaces(font, sheet, index, look, width, height, crease, fold, strokesWidth) : null),
    // look matters through its paper, ink and seed (the font is loaded from look.font)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [font, sheet, index, look.paper, look.ink, look.seed, width, height, crease, fold, strokesWidth],
  );
}

/**
 * Bakes, kept with the content they were made from: a face's ink and its ghost on the
 * other side, a sheet's finished faces. Keyed by the content object (edits make new
 * ones, and the old bakes go with them) plus everything else they depend on. A turn
 * then finds its faces ready (the desk bakes them while you pause), and the desk's
 * show-through is the very ghost the turn baked.
 */
const faceBakes = new WeakMap<FaceContent, { key: string; ink: SkPicture | null; ghost?: SkImage | null }>();
const sheetBakes = new WeakMap<SheetContent, { key: string; faces: SheetFaces }>();
const bakeKey = (font: SkFont, look: LetterLook, width: number, height: number, ...more: unknown[]) =>
  [font.getSize(), look.font, look.ink, look.paper, look.seed, width, height, ...more].join('|');

/** One face's ink (text and pen strokes), or null for a blank face. */
function faceInk(font: SkFont, f: FaceContent, ref: FaceRef, look: LetterLook, width: number, height: number, strokesWidth: number | undefined) {
  if (isEmptyFace(f)) return { ink: null } as { ink: null; ghost?: SkImage | null };
  const key = bakeKey(font, look, width, height, ref.sheet, ref.side, strokesWidth);
  let bake = faceBakes.get(f);
  if (bake?.key !== key) {
    const pic = recordLetter({
      font,
      paper: paperFor(look.paper, width),
      ink: INKS[look.ink].rgb,
      sheet: { width, height },
      crease: 0,
      text: f.text,
      side: ref.side,
      seed: inkSeed(look.seed, ref),
      layers: 'ink',
      extraLines: 1,
    });
    bake = { key, ink: withStrokes(pic, f.strokes, strokesWidth, look, width, height) };
    faceBakes.set(f, bake);
  }
  return bake;
}

/** That face's ink as it shows through to the other side. */
function faceGhost(font: SkFont, f: FaceContent, ref: FaceRef, look: LetterLook, width: number, height: number, strokesWidth: number | undefined) {
  const bake = faceInk(font, f, ref, look, width, height, strokesWidth);
  if (bake.ghost === undefined) bake.ghost = bakeGhost(bake.ink, { width, height }, paperFor(look.paper, width));
  return bake.ghost;
}

/** useSheetFaces without the hook, for a bake on demand (the desk bakes only when a sheet turns, or you pause). */
export function bakeSheetFaces(
  font: SkFont,
  sheet: SheetContent,
  index: number,
  look: LetterLook,
  width: number,
  height: number,
  crease: number,
  fold: FoldKind,
  strokesWidth: number | undefined,
  /** Keep the bake with the sheet (false: the caller owns it, and frees it). */
  keep = true,
): SheetFaces {
  const key = bakeKey(font, look, width, height, index, crease, fold, strokesWidth);
  const kept = sheetBakes.get(sheet);
  if (keep && kept?.key === key) return kept.faces;
  const paper = paperFor(look.paper, width);
  const size = { width, height };
  const written = (side: Side) => (side === 'verso' && !sheet.twoSided ? emptyFace() : sheet[side]);
  const bake = (side: Side, other: Side) => {
    const ghost = faceGhost(font, written(other), { sheet: index, side: other }, look, width, height, strokesWidth);
    const base = recordLetter({
      font,
      paper,
      ink: INKS[look.ink].rgb,
      sheet: size,
      crease,
      fold,
      paperSeed: paperSeed(look.seed, index),
      foldSeed: look.seed,
      text: '',
      side,
      seed: look.seed,
      layers: 'paper',
      ghost,
    });
    const top = faceInk(font, written(side), { sheet: index, side }, look, width, height, strokesWidth).ink;
    if (!top) return flatten(base, size);
    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    canvas.drawPicture(base);
    canvas.drawPicture(top);
    return flatten(rec.finishRecordingAsPicture(), size);
  };
  // Flattened into images: a turn draws these every frame (raster.ts).
  const verso = bake('verso', 'recto');
  const faces = { recto: bake('recto', 'verso'), verso, versoThrough: mirrorPicture(verso, size) };
  if (keep) sheetBakes.set(sheet, { key, faces });
  return faces;
}

/**
 * A stack folded as one: the top sheet's recto and the back of the last sheet
 * (FoldableLetter's front and back), how many sheets, and the colour of their cut edges.
 */
export function useStackPictures(
  sheets: SheetContent[],
  look: LetterLook,
  width: number,
  height: number,
  crease: number,
  fold: FoldKind,
  strokesWidth: number | undefined,
) {
  const n = sheets.length;
  const top = useSheetFaces(sheets[0], 0, look, width, height, crease, fold, strokesWidth);
  const last = useSheetFaces(n > 1 ? sheets[n - 1] : undefined, n - 1, look, width, height, crease, fold, strokesWidth);
  return {
    front: top?.recto ?? null,
    back: (n > 1 ? last : top)?.versoThrough ?? null,
    sheets: n,
    edgeColor: paperEdgeColor(look.paper),
  };
}

/** The cut edge of a sheet: its paper, a shade darker. */
export function paperEdgeColor(paper: PaperKind) {
  const [r, g, b] = PAPERS[paper].base.map((v) => Math.round(v * 0.94 * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

/** The other face's ink as it shows through to this one (for the desk, which bakes paper and ink apart). */
export function useGhostOf(face: FaceContent | undefined, ref: FaceRef, look: LetterLook, width: number, height: number, strokesWidth: number) {
  const font = useSharedFont(HANDWRITING_FONTS[look.font].file, fontSizeFor(paperFor(look.paper, width), width));
  return useMemo(
    () => (font && face ? faceGhost(font, face, ref, look, width, height, strokesWidth) : null),
    // look matters through its paper, ink and seed (the font is loaded from look.font)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [font, face, ref.sheet, ref.side, look.paper, look.ink, look.seed, width, height, strokesWidth],
  );
}

/**
 * The pen layer (signature, P.S., doodles) over a baked sheet. Strokes are stored in
 * pixels of the sheet they were written on (`writtenWidth`) and scaled to this one,
 * with the same nib and ink as at the desk.
 */
export function useWithStrokes(
  base: SkPicture | null,
  strokes: Stroke[] | undefined,
  writtenWidth: number | undefined,
  look: LetterLook,
  width: number,
  height: number,
) {
  return useMemo(
    () => withStrokes(base, strokes, writtenWidth, look, width, height),
    // look matters only through paper and ink
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, strokes, writtenWidth, look.paper, look.ink, width, height],
  );
}

function withStrokes<P extends SkPicture | null>(
  base: P,
  strokes: Stroke[] | undefined,
  writtenWidth: number | undefined,
  look: Pick<LetterLook, 'paper' | 'ink'>,
  width: number,
  height: number,
): P {
  if (!base || !strokes?.length || !writtenWidth) return base;
  const rec = Skia.PictureRecorder();
  const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
  canvas.drawPicture(base);
  const nib = fontSizeFor(paperFor(look.paper, writtenWidth), writtenWidth) * 0.16;
  const ink = Skia.Paint();
  ink.setAntiAlias(true);
  ink.setColor(Skia.Color(INKS[look.ink].color));
  ink.setAlphaf(0.93);
  ink.setBlendMode(BlendMode.Multiply);
  canvas.save();
  canvas.scale(width / writtenWidth, width / writtenWidth);
  for (const s of strokes) canvas.drawPath(strokeToPath(s, nib), ink);
  canvas.restore();
  return rec.finishRecordingAsPicture() as P;
}

const PAD = 24;

/** A flat sheet lying on the desk, with a soft contact shadow. */
export function LetterSheet({
  text,
  look,
  width,
  height,
  crease = 0,
  strokes,
  strokesWidth,
  fold = 'tri',
  style,
}: {
  text: string;
  look: LetterLook;
  width: number;
  height: number;
  crease?: number;
  /** Pen strokes written at the desk on a sheet `strokesWidth` wide. */
  strokes?: Stroke[];
  strokesWidth?: number;
  /** Where its creases are. */
  fold?: FoldKind;
  style?: StyleProp<ViewStyle>;
}) {
  const { picture: sheet } = useLetterPicture(text, look, width, height, crease, 'all', fold);
  const picture = useWithStrokes(sheet, strokes, strokesWidth, look, width, height);
  return (
    // Skia's web Canvas hands `style` to a DOM element, so it must be a flat object.
    <Canvas style={StyleSheet.flatten([{ width: width + PAD * 2, height: height + PAD * 2 }, style])}>
      <Group transform={[{ translateX: PAD }, { translateY: PAD }]}>
        <Rect x={0} y={0} width={width} height={height} color="#000">
          <Shadow dx={2} dy={6} blur={10} color="rgba(20, 12, 4, 0.35)" shadowOnly />
          <Shadow dx={0} dy={1} blur={1.5} color="rgba(20, 12, 4, 0.4)" shadowOnly />
        </Rect>
        {picture && <Picture picture={picture} />}
      </Group>
    </Canvas>
  );
}
