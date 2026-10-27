import { Canvas, Picture } from '@shopify/react-native-skia';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Country } from '../../theme/stationery';
import type { Lang } from '../tracking/copy';
import { DESK_COPY } from './deskCopy';
import { cardRect, keptPicture, layoutKey, recordApron, recordNosing } from './deskPictures';
import { DESK_PRESETS } from './deskUniforms';
import { DRAWERS, type ApronProps, type DeskLayout, type DrawerKey } from './types';

const STATIC = Platform.OS === 'web';

/**
 * The fixed band at the bottom of the screen (spec §2.2, §5.4): the nosing, the apron board, the
 * three closed fronts with their pulls and card holders, the knee shadow and the floor. One static
 * canvas, `layout.width` × `layout.band.height`; the parent places it at `band.top` and moves it only
 * by view transforms. The fronts' labels are RN Text over the cards (crisp, translatable).
 */
export function ApronCanvas({ layout, preset, seed, lang, style }: ApronProps & { style?: StyleProp<ViewStyle> }) {
  const { width, band } = layout;
  const picture = keptPicture(`apron:${layoutKey(layout)}:${preset}:${seed}`, () => recordApron(layout, preset, seed));
  return (
    <View pointerEvents="none" style={[{ width, height: band.height }, style]}>
      <Canvas style={StyleSheet.flatten([styles.fill, { width, height: band.height }])} __destroyWebGLContextAfterRender={STATIC}>
        <Picture picture={picture} />
      </Canvas>
      {DRAWERS.map((key) => {
        const f = layout.fronts[key];
        return <FrontLabel key={key} layout={layout} drawer={key} lang={lang} preset={preset} x={f.x} y={f.y - band.top} />;
      })}
    </View>
  );
}

/**
 * A front's label, handwritten on its card: Marck Script 12 (× the fronts' size), `#3a2c22` on `#efe2cc`.
 * (x, y) is the front's top-left in the parent's coordinates.
 */
export function FrontLabel({
  layout,
  drawer,
  lang,
  preset,
  x,
  y,
}: {
  layout: DeskLayout;
  drawer: DrawerKey;
  lang: Lang;
  preset: Country;
  x: number;
  y: number;
}) {
  const f = layout.fronts[drawer];
  const card = cardRect(f.width, f.height);
  const k = f.height / 44;
  return (
    <Text
      numberOfLines={1}
      allowFontScaling={false}
      style={[
        styles.label,
        {
          left: x + card.x,
          top: y + card.y,
          width: card.width,
          height: card.height,
          fontSize: 12 * k,
          lineHeight: card.height,
          color: DESK_PRESETS[preset].label,
        },
      ]}
    >
      {DESK_COPY[lang].fronts[drawer]}
    </Text>
  );
}

/** The nosing strip on its own, `layout.width` × `band.nosing`: it lies over an open drawer's box. */
export function Nosing({
  layout,
  preset,
  seed,
  style,
}: {
  layout: DeskLayout;
  preset: Country;
  seed: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { width, band } = layout;
  const picture = keptPicture(`nosing:${layoutKey(layout)}:${preset}:${seed}`, () => recordNosing(layout, preset, seed));
  return (
    <Canvas
      style={StyleSheet.flatten([{ width, height: band.nosing }, style])}
      pointerEvents="none"
      __destroyWebGLContextAfterRender={STATIC}
    >
      <Picture picture={picture} />
    </Canvas>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, top: 0 },
  label: {
    position: 'absolute',
    fontFamily: 'MarckScript_400Regular',
    textAlign: 'center',
    includeFontPadding: false,
    // The label is written a little crooked.
    transform: [{ rotate: '-1deg' }],
  },
});
