import { Canvas, Group, Picture, Rect, Shadow, useFont } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { HANDWRITING_FONTS, INKS, type FontKey, type InkKind, type PaperKind } from '../theme/stationery';
import { layoutLetter, recordLetter } from './renderLetter';
import { fontSizeFor, paperFor } from './sheet';

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
    };
    const layout = layoutLetter(input);
    return { picture: recordLetter(input, layout), overflow: layout.overflowAt >= 0 };
    // paper is derived from look.paper + width
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, text, look.paper, look.ink, look.seed, width, height, crease, layers]);
}

const PAD = 24;

/** A flat sheet lying on the desk, with a soft contact shadow. */
export function LetterSheet({
  text,
  look,
  width,
  height,
  crease = 0,
  style,
}: {
  text: string;
  look: LetterLook;
  width: number;
  height: number;
  crease?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { picture } = useLetterPicture(text, look, width, height, crease);
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
