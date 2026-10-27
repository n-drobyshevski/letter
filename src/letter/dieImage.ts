import {
  BlurStyle,
  FillType,
  Skia,
  drawAsImageFromPicture,
  useFont,
  type SkFont,
  type SkImage,
  type SkPath,
  type SkPicture,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { PixelRatio } from 'react-native';

import { HANDWRITING_FONTS } from '../theme/stationery';
import { recordMonogram } from './envelope';
import { SEAL_BOX, SEAL_DIES, type SealDie } from './sealDies';

/**
 * The die's imprint as a height map (alpha 1 = raised in the wax) for WAX_SKSL's `die`
 * child: a square image covering the die disc (100 path units = the die's diameter).
 *
 * 'monogram' keeps today's look exactly (recordMonogram: the initials and a plain ring),
 * so letters sealed before dies existed still show the same seal. The motif dies get the
 * beaded border and their motif from sealDies.ts, filled white and softened with the same
 * blur (size × 0.008), which gives the relief its rounded shoulders.
 */

// Parsed once per die, in the 100-unit box; they never change.
const pathCache = new Map<SealDie, SkPath[]>();

/** The die's paths (border first, then the motif), in the 100-unit box. */
export function diePaths(die: SealDie): SkPath[] {
  let paths = pathCache.get(die);
  if (!paths) {
    paths = [];
    for (const p of SEAL_DIES[die].paths) {
      const path = Skia.Path.MakeFromSVGString(p.d);
      if (!path) continue;
      paths.push(
        Skia.PathBuilder.MakeFromPath(path)
          .setFillType(p.evenOdd ? FillType.EvenOdd : FillType.Winding)
          .detach(),
      );
    }
    pathCache.set(die, paths);
  }
  return paths;
}

/** Monogram font size for a die image of side `size` (today's useMonogram sizes: 0.62 / 0.95 of the die's diameter, image at 2×). */
export const monogramFontSize = (size: number, initials: string) => size * (initials.length > 1 ? 0.31 : 0.475);

/**
 * Records the imprint for `die` into a `size` × `size` picture. 'monogram' needs `font`
 * (sized with monogramFontSize, from useFont: never Skia.Font(font.getTypeface())); without
 * it the result is null. The motif dies ignore initials and font.
 */
export function recordDie(die: SealDie, size: number, initials: string, font: SkFont | null): SkPicture | null {
  if (die === 'monogram') return font ? recordMonogram(initials, font, size) : null;
  const recorder = Skia.PictureRecorder();
  const c = recorder.beginRecording(Skia.XYWHRect(0, 0, size, size));
  const fill = Skia.Paint();
  fill.setAntiAlias(true);
  fill.setColor(Skia.Color('white'));
  fill.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, size * 0.008, true));
  c.save();
  c.scale(size / SEAL_BOX, size / SEAL_BOX);
  for (const path of diePaths(die)) c.drawPath(path, fill);
  c.restore();
  return recorder.finishRecordingAsPicture();
}

/**
 * Texture side for a die of radius `dieR` pt: at least 2× (today's monogram), one texel
 * per device pixel on denser screens, capped so a laptop-sized seal stays cheap.
 * Quantised to 8 px, so seals of nearly the same size share a texture.
 */
export function dieTextureSize(dieR: number) {
  const s = Math.ceil(dieR * 2 * Math.max(2, PixelRatio.get()));
  return Math.min(384, Math.max(16, Math.ceil(s / 8) * 8));
}

// One texture per (die, initials, size), shared by every WaxSeal that shows it (receiving
// draws the same seal up to four times; the tray and the ceremony share them too).
const dieCache = new Map<string, SkImage>();

/**
 * The die texture for a seal of die radius `dieR` pt, or null while the monogram's font
 * loads. Returns `{ image, size }`; size is WAX_SKSL's uDieSize.
 */
export function useDie(die: SealDie, initials: string, dieR: number) {
  const size = dieTextureSize(dieR);
  const mono = die === 'monogram';
  // Hooks can't be conditional: the motif dies pass no font file, so nothing loads.
  const font = useFont(mono ? HANDWRITING_FONTS.marckScript.file : null, monogramFontSize(size, initials));
  return useMemo(() => {
    const key = `${die}:${mono ? initials : ''}:${size}`;
    let image = dieCache.get(key) ?? null;
    if (!image) {
      const picture = recordDie(die, size, initials, font);
      if (!picture) return null;
      image = drawAsImageFromPicture(picture, { width: size, height: size });
      if (!image) return null;
      dieCache.set(key, image);
    }
    return { image, size };
  }, [die, mono, initials, size, font]);
}
