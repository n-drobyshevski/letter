import {
  BlurStyle,
  ClipOp,
  FilterMode,
  MipmapMode,
  Skia,
  type SkImage,
  type SkPicture,
  type SkSurface,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { PixelRatio, Platform } from 'react-native';

import type { SheetGeometry } from './paperLayout';

/**
 * Baked pictures turned into images, once, so a frame draws a texture instead of
 * replaying them. A sheet's picture is the procedural paper shader plus every word's
 * blurred ink: cheap to record, costly to replay, and a page turn replays four or
 * more of them a frame. RN Skia's own advice: draw complex static content once into
 * a texture, then animate that with transforms.
 *
 * On the web every offscreen GPU surface is a WebGL context of its own, never freed
 * (a page gets 16 before the browser evicts the oldest, visible or not), so all bakes
 * share one surface, grown as needed. The result is read back into a plain image:
 * each canvas uploads it to its own context once and keeps it.
 */

const web = Platform.OS === 'web';
// Pixels per point: the screen's, but no more than 2 (four images a letter, two faces each).
export const RASTER_SCALE = Math.min(2, Math.max(1, PixelRatio.get()));

let shared: { surface: SkSurface; w: number; h: number } | null = null;

function surfaceFor(w: number, h: number): SkSurface | null {
  if (!web) return Skia.Surface.MakeOffscreen(w, h);
  if (shared && shared.w >= w && shared.h >= h) return shared.surface;
  if (shared) {
    shared.surface.flush();
    shared.surface.dispose();
  }
  // Grown a step at a time, so sizes close to each other share it.
  const sw = Math.max(w, shared?.w ?? 0, Math.ceil(w / 256) * 256);
  const sh = Math.max(h, shared?.h ?? 0, Math.ceil(h / 256) * 256);
  const surface = Skia.Surface.MakeOffscreen(sw, sh);
  shared = surface ? { surface, w: sw, h: sh } : null;
  return surface;
}

/** `picture` (in pixels, from 0, 0) drawn into a `w` × `h` image, or null if there is no GPU surface to draw it on. */
export function rasterize(picture: SkPicture, w: number, h: number): SkImage | null {
  w = Math.ceil(w);
  h = Math.ceil(h);
  if (!(w > 0 && h > 0)) return null;
  const surface = surfaceFor(w, h);
  if (!surface) return null;
  try {
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    // The shared surface may be larger: keep layers (a blur) to the image.
    canvas.save();
    canvas.clipRect(Skia.XYWHRect(0, 0, w, h), ClipOp.Intersect, false);
    canvas.drawPicture(picture);
    canvas.restore();
    // flush() makes this surface's context the current one; it must stay so for the rest:
    // CanvasKit runs a GPU object's clean-up in whatever context is current, and one left
    // for the garbage collector can free textures of a canvas on screen.
    surface.flush();
    const snapshot = surface.makeImageSnapshot(Skia.XYWHRect(0, 0, w, h));
    const image = snapshot.makeNonTextureImage();
    snapshot.dispose();
    return image;
  } catch {
    // A lost context (evicted, or a GPU reset): start over on a new one next time.
    if (web) shared = null;
    return null;
  } finally {
    if (!web) surface.dispose();
  }
}

/** A picture that draws `image` over `rect` (smoothly scaled): what callers of a baked picture keep drawing. */
export function imagePicture(image: SkImage, rect: { x: number; y: number; width: number; height: number }): SkPicture {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(rect.x, rect.y, rect.width, rect.height));
  canvas.drawImageRectOptions(
    image,
    Skia.XYWHRect(0, 0, image.width(), image.height()),
    Skia.XYWHRect(rect.x, rect.y, rect.width, rect.height),
    FilterMode.Linear,
    MipmapMode.None,
    null,
  );
  return recorder.finishRecordingAsPicture();
}

/** `picture` (a sheet, in points) flattened into an image at RASTER_SCALE, still as a picture; the picture itself if that fails. */
export function flatten(picture: SkPicture, sheet: SheetGeometry): SkPicture {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, sheet.width * RASTER_SCALE, sheet.height * RASTER_SCALE));
  canvas.scale(RASTER_SCALE, RASTER_SCALE);
  canvas.drawPicture(picture);
  const image = rasterize(recorder.finishRecordingAsPicture(), sheet.width * RASTER_SCALE, sheet.height * RASTER_SCALE);
  if (!image) return picture;
  const flat = imagePicture(image, { x: 0, y: 0, ...sheet });
  // The picture holds the pixels now: they go when it does (see DeskStack's top-sheet bake).
  image.dispose();
  return flat;
}

export type ShadowSpec = { dx: number; dy: number; blur: number; color: string };

/**
 * A sheet's soft shadow on the desk, baked: an image and where it goes (in the sheet's
 * coordinates). The same as a shadowOnly <Shadow> under the sheet's Rect, without
 * blurring a sheet-sized layer every frame.
 */
export function bakeShadow(sheet: SheetGeometry, shadows: ShadowSpec[]): { image: SkImage; rect: { x: number; y: number; width: number; height: number } } | null {
  // <Shadow blur> is a sigma; 3σ holds all of it.
  const pad = Math.ceil(Math.max(...shadows.map((s) => s.blur * 3 + Math.max(Math.abs(s.dx), Math.abs(s.dy)))));
  const rect = { x: -pad, y: -pad, width: sheet.width + pad * 2, height: sheet.height + pad * 2 };
  const s = RASTER_SCALE;
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, rect.width * s, rect.height * s));
  canvas.scale(s, s);
  canvas.translate(pad, pad);
  for (const sh of shadows) {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color(sh.color));
    paint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, sh.blur, true));
    canvas.drawRect(Skia.XYWHRect(sh.dx, sh.dy, sheet.width, sheet.height), paint);
  }
  const image = rasterize(recorder.finishRecordingAsPicture(), rect.width * s, rect.height * s);
  return image ? { image, rect } : null;
}

/** bakeShadow, once per sheet size (`shadows` is a constant of the caller). */
export function useShadow(sheet: SheetGeometry, shadows: ShadowSpec[]) {
  return useMemo(
    () => bakeShadow(sheet, shadows),
    // the specs are module constants
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet.width, sheet.height],
  );
}
