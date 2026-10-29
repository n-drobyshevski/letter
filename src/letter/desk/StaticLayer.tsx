import { Canvas, Picture, type SkPicture } from '@shopify/react-native-skia';
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

export type StaticLayerProps = {
  /** What the layer shows: a new key draws it again. */
  cacheKey: string;
  width: number;
  height: number;
  /** Records the layer (in points, from 0, 0); called only when there is no drawn copy to show. */
  record: () => SkPicture;
  style?: StyleProp<ViewStyle>;
};

/**
 * A layer of the desk that never moves by itself (wood, leather, the apron, a drawer box).
 * Native: a canvas that replays its picture (a redraw costs nothing but the GPU). The web has
 * its own version (StaticLayer.web.tsx): drawn once into a plain 2D canvas and kept between visits.
 */
export function StaticLayer({ cacheKey, width, height, record, style }: StaticLayerProps) {
  // Recorded again only for a new key (a new `record` closure alone draws the same thing).
  const [kept, setKept] = useState(() => ({ key: cacheKey, picture: record() }));
  let picture = kept.picture;
  if (kept.key !== cacheKey) {
    picture = record();
    setKept({ key: cacheKey, picture });
  }
  return (
    <View pointerEvents="none" style={[{ width, height }, style]}>
      <Canvas style={StyleSheet.flatten([styles.fill, { width, height }])}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, top: 0 },
});
