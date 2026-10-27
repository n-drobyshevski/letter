import {
  BlendMode,
  BlurStyle,
  Skia,
  type SkFont,
  type SkImage,
  type SkPicture,
  type SkRuntimeEffect,
} from '@shopify/react-native-skia';

import type { PaperSpec, Rgb } from '../theme/stationery';
import { layoutHandwriting, type HandwritingLayout } from './handwriting';
import { paperUniforms, writingArea, type SheetGeometry, type Side } from './paperLayout';
import { INK_SKSL, PAPER_SKSL } from './shaders';
import { drawGhost } from './showThrough';

let paperEffect: SkRuntimeEffect | null = null;
let inkEffect: SkRuntimeEffect | null = null;

function effects() {
  paperEffect ??= Skia.RuntimeEffect.Make(PAPER_SKSL);
  inkEffect ??= Skia.RuntimeEffect.Make(INK_SKSL);
  if (!paperEffect || !inkEffect) throw new Error('Letter shaders failed to compile');
  return { paper: paperEffect, ink: inkEffect };
}

export { creaseOffsets, paperUniforms, writingArea, type SheetGeometry, type Side } from './paperLayout';

export function measureWithFont(font: SkFont) {
  return (word: string) => {
    const widths = font.getGlyphWidths(font.getGlyphIDs(word));
    let sum = 0;
    for (const w of widths) sum += w;
    return sum;
  };
}

export type LetterRenderInput = {
  text: string;
  font: SkFont;
  paper: PaperSpec;
  ink: Rgb;
  seed: number;
  sheet: SheetGeometry;
  /** Crease visibility: 0 = never folded, 1 = freshly folded, ~0.35 = unfolded after reading. */
  crease: number;
  /** Record only one layer, e.g. paper alone for the writing desk or a panel's back side. */
  layers?: 'all' | 'paper' | 'ink';
  /** Where the creases are (see fold.ts). */
  fold?: 'tri' | 'half' | 'quarter';
  /** Which face: the verso mirrors the paper (margin on the left) and the writing area. */
  side?: Side;
  /** Pulp of this sheet (defaults to `seed`); `seed` itself drives the handwriting jitter and ink. */
  paperSeed?: number;
  /** Creases of the whole stack (defaults to `seed`). */
  foldSeed?: number;
  /** The other face's ink, already mirrored and blurred (showThrough.ts), drawn into the paper. */
  ghost?: SkImage | null;
  /** Lines allowed past the sheet's own count: a face written at one width never loses words at another. */
  extraLines?: number;
};

export function layoutLetter(input: LetterRenderInput): HandwritingLayout {
  const area = writingArea(input.paper, input.sheet, input.font.getSize(), input.side);
  return layoutHandwriting(input.text, measureWithFont(input.font), {
    seed: input.seed,
    fontSize: input.font.getSize(),
    ...area,
    maxLines: area.maxLines + (input.extraLines ?? 0),
  });
}

/**
 * Draws the whole sheet (paper + ink) into a picture. This is the "bake": it
 * runs once per change, and animations only move the resulting picture around.
 */
export function recordLetter(input: LetterRenderInput, layout = layoutLetter(input)): SkPicture {
  const { paper, ink } = effects();
  const { width, height } = input.sheet;
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, width, height));

  const layers = input.layers ?? 'all';
  if (layers !== 'ink') {
    const paperPaint = Skia.Paint();
    paperPaint.setShader(
      paper.makeShader(
        paperUniforms(input.paper, input.sheet, input.paperSeed ?? input.seed, input.crease, input.fold, input.side, input.foldSeed ?? input.seed),
      ),
    );
    canvas.drawRect(Skia.XYWHRect(0, 0, width, height), paperPaint);
    if (input.ghost) drawGhost(canvas, input.ghost, input.sheet, input.paper.showThrough);
  }
  if (layers === 'paper') return recorder.finishRecordingAsPicture();

  const inkShader = ink.makeShader([...input.ink, input.seed % 997]);

  // Feathering: a faint blurred halo under each stroke, stronger on soft paper.
  const bleed = Skia.Paint();
  bleed.setShader(inkShader);
  bleed.setBlendMode(BlendMode.Multiply);
  bleed.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 0.5 + input.paper.bleed, true));

  const stroke = Skia.Paint();
  stroke.setShader(inkShader);
  stroke.setBlendMode(BlendMode.Multiply);

  for (const w of layout.words) {
    canvas.save();
    canvas.translate(w.x, w.y);
    canvas.rotate((w.rotation * 180) / Math.PI, 0, 0);
    canvas.scale(w.scale, w.scale);
    bleed.setAlphaf(w.opacity * 0.22 * (0.5 + input.paper.bleed));
    canvas.drawText(w.text, 0, 0, bleed, input.font);
    stroke.setAlphaf(w.opacity);
    canvas.drawText(w.text, 0, 0, stroke, input.font);
    canvas.restore();
  }

  return recorder.finishRecordingAsPicture();
}
