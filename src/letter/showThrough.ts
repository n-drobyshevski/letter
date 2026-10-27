import {
  BlendMode,
  FilterMode,
  MipmapMode,
  Skia,
  TileMode,
  type SkCanvas,
  type SkImage,
  type SkPicture,
} from '@shopify/react-native-skia';

import type { PaperSpec } from '../theme/stationery';
import type { SheetGeometry } from './paperLayout';
import { rasterize } from './raster';

/**
 * Show-through: the ink on one face of a sheet, seen faintly from the other.
 * It reads mirrored (the sheet was turned like a book page), softened by light
 * scattering in the fibres, and a little warmer and greyer than the ink itself.
 * Baked once into a half-resolution image (the blur hides the pixels) so panels
 * that replay a face every frame never blur anything live. It is drawn on the
 * shared bake surface (raster.ts), not a GPU surface of its own.
 */

const SCALE = 0.5;

// Ink seen through pulp: about half desaturated, nudged warm.
const THROUGH_PULP = [
  0.62, 0.3, 0.08, 0, 0.03,
  0.2, 0.68, 0.1, 0, 0.02,
  0.18, 0.32, 0.5, 0, 0.0,
  0, 0, 0, 1, 0,
];

/** The ghost of `ink` (one face's ink and pen strokes) as seen from the other side, or null for a blank face. */
export function bakeGhost(ink: SkPicture | null, sheet: SheetGeometry, paper: PaperSpec): SkImage | null {
  const w = Math.ceil(sheet.width * SCALE);
  const h = Math.ceil(sheet.height * SCALE);
  if (!ink || !(w > 0 && h > 0)) return null;
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, w, h));
  const blur = paper.ghostBlur * (sheet.width / 440) * SCALE;
  const layer = Skia.Paint();
  layer.setImageFilter(Skia.ImageFilter.MakeBlur(blur, blur, TileMode.Decal, null));
  layer.setColorFilter(Skia.ColorFilter.MakeMatrix(THROUGH_PULP));
  canvas.saveLayer(layer);
  canvas.scale(SCALE, SCALE);
  canvas.translate(sheet.width, 0);
  canvas.scale(-1, 1);
  canvas.drawPicture(ink);
  canvas.restore();
  return rasterize(recorder.finishRecordingAsPicture(), w, h);
}

/** Multiplies a baked ghost into the paper at the paper's show-through strength. */
export function drawGhost(canvas: SkCanvas, ghost: SkImage, sheet: SheetGeometry, strength: number) {
  const paint = Skia.Paint();
  paint.setAlphaf(strength);
  paint.setBlendMode(BlendMode.Multiply);
  canvas.drawImageRectOptions(
    ghost,
    Skia.XYWHRect(0, 0, ghost.width(), ghost.height()),
    Skia.XYWHRect(0, 0, sheet.width, sheet.height),
    FilterMode.Linear,
    MipmapMode.None,
    paint,
  );
}

/** The same picture seen from behind across a vertical axis: a face in the coordinates of the other face. */
export function mirrorPicture(picture: SkPicture, sheet: SheetGeometry): SkPicture {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, sheet.width, sheet.height));
  canvas.translate(sheet.width, 0);
  canvas.scale(-1, 1);
  canvas.drawPicture(picture);
  return recorder.finishRecordingAsPicture();
}
