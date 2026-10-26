import { BlendMode, Canvas, Group, Picture, Rect, Shadow, Skia, useFont, type SkPicture } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { HANDWRITING_FONTS, INKS, type FontKey, type InkKind, type PaperKind } from '../theme/stationery';
import { layoutLetter, recordLetter } from './renderLetter';
import type { FoldKind } from './fold';
import { fontSizeFor, paperFor } from './sheet';
import { strokeToPath, type Stroke } from './strokes';

export type LetterLook = {
  paper: PaperKind;
  ink: InkKind;
  font: FontKey;
  seed: number;
};

/** Bakes a letter into a Skia picture once per (text, look, size). `overflow` is true when the sheet is full. */
export function useLetterPicture(
  text: string,
  look: LetterLook,
  width: number,
  height: number,
  crease = 0,
  layers: 'all' | 'paper' | 'ink' = 'all',
  fold: FoldKind = 'tri',
) {
  const paper = paperFor(look.paper, width);
  const font = useFont(HANDWRITING_FONTS[look.font].file, fontSizeFor(paper, width));
  return useMemo(() => {
    if (!font) return { picture: null, overflow: false };
    const input = {
      text,
      font,
      paper,
      ink: INKS[look.ink].rgb,
      seed: look.seed,
      sheet: { width, height },
      crease,
      layers,
      fold,
    };
    const layout = layoutLetter(input);
    return { picture: recordLetter(input, layout), overflow: layout.overflowAt >= 0 };
    // paper is derived from look.paper + width
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, text, look.paper, look.ink, look.seed, width, height, crease, layers, fold]);
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
  return useMemo(() => {
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
    return rec.finishRecordingAsPicture();
  }, [base, strokes, writtenWidth, look.paper, look.ink, width, height]);
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
