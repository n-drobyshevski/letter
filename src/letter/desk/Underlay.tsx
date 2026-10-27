import { Canvas, Picture } from '@shopify/react-native-skia';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';

import { keptPicture, layoutKey, recordResting, recordUnderlay, underlayHeight } from './deskPictures';
import type { UnderlayProps } from './types';

/** Static canvases on web give their WebGL context back after drawing (Chrome allows 16 per page). */
const STATIC = Platform.OS === 'web';

/**
 * The desk top under the scroll content (spec §5.4): wood over the whole content (its height rounded up
 * to a 200 pt bucket), the sous-main round the measured sheet, the sheet's contact shadow, and on a
 * laptop with room beside the pad the paper, pen, bottle and envelope in use. One static canvas,
 * absolutely placed at the content's top-left, never touched by a gesture: it redraws only when the
 * window, the sheet's rect, the preset or a resting item changes.
 */
export function Underlay({
  layout,
  preset,
  seed,
  sheetRect,
  contentHeight,
  resting,
  restingStyle,
  style,
}: UnderlayProps & { restingStyle?: StyleProp<AnimatedStyle<ViewStyle>>; style?: StyleProp<ViewStyle> }) {
  const height = underlayHeight(contentHeight);
  const r = sheetRect;
  const rect = r ? `${r.x},${r.y},${r.width},${r.height}` : '-';
  const key = ['underlay', layoutKey(layout), preset, seed, height, rect].join(':');
  // The desk top alone: a pick (a new resting item) never redraws the wood and leather.
  const picture = keptPicture(key, () => recordUnderlay(layout, preset, seed, sheetRect, height, null));
  const restingKey = resting
    ? [
        'resting',
        layoutKey(layout),
        seed,
        height,
        rect,
        resting.paper,
        resting.pen,
        resting.ink,
        resting.envelope.paper,
        resting.envelope.liner,
      ].join(':')
    : null;
  const items =
    resting && restingKey ? keptPicture(restingKey, () => recordResting(layout, seed, sheetRect, height, resting)) : null;
  // Skia's web Canvas hands `style` to a DOM element, so it must be a flat object.
  const canvasStyle = StyleSheet.flatten([styles.under, { width: layout.width, height }, style]);
  return (
    <>
      <Canvas style={canvasStyle} pointerEvents="none" __destroyWebGLContextAfterRender={STATIC}>
        <Picture picture={picture} />
      </Canvas>
      {/* The laptop's resting items, on their own layer: they fade while a drawer is open. */}
      {items && (
        <Animated.View pointerEvents="none" style={[styles.under, { width: layout.width, height }, restingStyle]}>
          <Canvas
            style={StyleSheet.flatten([styles.under, { width: layout.width, height }])}
            __destroyWebGLContextAfterRender={STATIC}
          >
            <Picture picture={items} />
          </Canvas>
        </Animated.View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  under: { position: 'absolute', left: 0, top: 0 },
});
