import { useTypeface, type SkTypeface } from '@shopify/react-native-skia';

import { HANDWRITING_FONTS, PRINT_FONTS } from '../theme/stationery';

export type Typefaces = {
  hand: SkTypeface;
  marker: SkTypeface;
  print: SkTypeface;
  printBold: SkTypeface;
};

/**
 * Every typeface the postal scenes need, or null while they load.
 * Loaded as owned typefaces (not `font.getTypeface()`, which on web is a borrowed
 * pointer that `Skia.Font` refuses).
 */
export function useTypefaces(): Typefaces | null {
  const hand = useTypeface(HANDWRITING_FONTS.badScript.file);
  const marker = useTypeface(HANDWRITING_FONTS.caveat.file);
  const print = useTypeface(PRINT_FONTS.regular);
  const printBold = useTypeface(PRINT_FONTS.bold);
  if (!hand || !marker || !print || !printBold) return null;
  return { hand, marker, print, printBold };
}
