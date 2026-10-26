import {
  BlendMode,
  BlurStyle,
  Skia,
  type SkFont,
  type SkPicture,
  type SkRuntimeEffect,
} from '@shopify/react-native-skia';

import { mulberry32, subSeed, wobble } from '../lib/random';
import { LIGHT_DIR, type PaperSpec, type Rgb } from '../theme/stationery';
import { layoutHandwriting, type HandwritingLayout } from './handwriting';
import { INK_SKSL, PAPER_SKSL } from './shaders';

let paperEffect: SkRuntimeEffect | null = null;
let inkEffect: SkRuntimeEffect | null = null;

function effects() {
  paperEffect ??= Skia.RuntimeEffect.Make(PAPER_SKSL);
  inkEffect ??= Skia.RuntimeEffect.Make(INK_SKSL);
  if (!paperEffect || !inkEffect) throw new Error('Letter shaders failed to compile');
  return { paper: paperEffect, ink: inkEffect };
}

export type SheetGeometry = { width: number; height: number };

/** The two fold lines of a tri-fold: near the thirds, never exactly on them. */
export function creaseOffsets(seed: number): [number, number] {
  const rand = mulberry32(subSeed(seed, 'fold'));
  return [wobble(rand, 5), wobble(rand, 5)];
}

export function paperUniforms(
  paper: PaperSpec,
  sheet: SheetGeometry,
  seed: number,
  crease: number,
  fold: 'tri' | 'half' | 'quarter' = 'tri',
): number[] {
  const [c1, c2] = creaseOffsets(seed);
  const marginX = paper.kind === 'grid' ? sheet.width - paper.cell * 2.6 : 0;
  return [
    sheet.width, sheet.height,
    seed % 9973,
    ...paper.base,
    paper.cell,
    marginX,
    ...paper.gridColor,
    ...paper.marginColor,
    crease,
    LIGHT_DIR.x, LIGHT_DIR.y,
    c1, c2,
    fold === 'tri' ? 0 : fold === 'half' ? 1 : 2,
  ];
}

export function measureWithFont(font: SkFont) {
  return (word: string) => {
    const widths = font.getGlyphWidths(font.getGlyphIDs(word));
    let sum = 0;
    for (const w of widths) sum += w;
    return sum;
  };
}

/** Writing area for a sheet: inside the margins, baselines on the grid. */
export function writingArea(paper: PaperSpec, sheet: SheetGeometry, fontSize: number) {
  if (paper.kind === 'grid') {
    // Notebook habit: start two cells in, write on every second line of cells,
    // baselines sitting exactly on a printed grid line.
    const cell = paper.cell;
    const left = cell * 2;
    const right = sheet.width - cell * 3.2;
    const lineHeight = cell * 2;
    const top = cell * 4;
    const maxLines = Math.floor((sheet.height - top - cell * 2) / lineHeight) + 1;
    return { left, top, maxWidth: right - left, lineHeight, maxLines };
  }
  const left = sheet.width * 0.1;
  const lineHeight = fontSize * 1.75;
  const top = sheet.height * 0.09 + lineHeight * 0.6;
  const maxLines = Math.floor((sheet.height * 0.93 - top) / lineHeight) + 1;
  return { left, top, maxWidth: sheet.width * 0.8, lineHeight, maxLines };
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
};

export function layoutLetter(input: LetterRenderInput): HandwritingLayout {
  const area = writingArea(input.paper, input.sheet, input.font.getSize());
  return layoutHandwriting(input.text, measureWithFont(input.font), {
    seed: input.seed,
    fontSize: input.font.getSize(),
    ...area,
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
    paperPaint.setShader(paper.makeShader(paperUniforms(input.paper, input.sheet, input.seed, input.crease, input.fold)));
    canvas.drawRect(Skia.XYWHRect(0, 0, width, height), paperPaint);
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
