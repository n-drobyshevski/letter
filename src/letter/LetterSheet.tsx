import { BlendMode, Canvas, Group, Picture, Rect, Shadow, Skia, useFont, type SkImage, type SkPicture } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { HANDWRITING_FONTS, INKS, PAPERS, type FontKey, type InkKind, type PaperKind } from '../theme/stationery';
import { layoutLetter, recordLetter, type Side } from './renderLetter';
import type { FoldKind } from './fold';
import { fontSizeFor, paperFor } from './sheet';
import { bakeGhost, mirrorPicture } from './showThrough';
import { inkSeed, isEmptyFace, paperSeed, type FaceContent, type FaceRef, type SheetContent } from './stack';
import { strokeToPath, type Stroke } from './strokes';

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
  const paper = paperFor(look.paper, width);
  const font = useFont(HANDWRITING_FONTS[look.font].file, fontSizeFor(paper, width));
  const sheet = face?.sheet ?? 0;
  const side = face?.side ?? 'recto';
  return useMemo(() => {
    if (!font) return { picture: null, overflow: false };
    const input = {
      text,
      font,
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
    const layout = layoutLetter(input);
    return { picture: recordLetter(input, layout), overflow: layout.overflowAt >= 0 };
    // paper is derived from look.paper + width
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, text, look.paper, look.ink, look.seed, width, height, crease, layers, fold, sheet, side, ghost]);
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
  const paper = paperFor(look.paper, width);
  const font = useFont(HANDWRITING_FONTS[look.font].file, fontSizeFor(paper, width));
  return useMemo(() => {
    if (!font || !sheet) return null;
    const size = { width, height };
    const common = {
      font,
      paper,
      ink: INKS[look.ink].rgb,
      sheet: size,
      crease,
      fold,
      paperSeed: paperSeed(look.seed, index),
      foldSeed: look.seed,
      extraLines: 1,
    };
    const inkOf = (side: Side) => {
      const f: FaceContent = sheet[side];
      if (isEmptyFace(f) || (side === 'verso' && !sheet.twoSided)) return null;
      const pic = recordLetter({ ...common, text: f.text, side, seed: inkSeed(look.seed, { sheet: index, side }), layers: 'ink' });
      return withStrokes(pic, f.strokes, strokesWidth, look, width, height);
    };
    const ink = { recto: inkOf('recto'), verso: inkOf('verso') };
    const bake = (side: Side, other: Side) => {
      const ghost = bakeGhost(ink[other], size, paper);
      const base = recordLetter({ ...common, text: '', side, seed: look.seed, layers: 'paper', ghost });
      const top = ink[side];
      if (!top) return base;
      const rec = Skia.PictureRecorder();
      const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
      canvas.drawPicture(base);
      canvas.drawPicture(top);
      return rec.finishRecordingAsPicture();
    };
    const verso = bake('verso', 'recto');
    return { recto: bake('recto', 'verso'), verso, versoThrough: mirrorPicture(verso, size) };
    // paper is derived from look.paper + width
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, sheet, index, look.paper, look.ink, look.seed, width, height, crease, fold, strokesWidth]);
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
  const empty = isEmptyFace(face);
  const { picture } = useLetterPicture(empty ? '' : face!.text, look, width, height, 0, 'ink', 'tri', { face: ref });
  return useMemo(() => {
    if (empty || !picture) return null;
    const ink = withStrokes(picture, face!.strokes, strokesWidth, look, width, height);
    return bakeGhost(ink, { width, height }, paperFor(look.paper, width));
    // face.strokes is what matters, not the face object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty, picture, face?.strokes, strokesWidth, look.paper, look.ink, width, height]);
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
