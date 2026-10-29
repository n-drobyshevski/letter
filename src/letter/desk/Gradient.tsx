import { Canvas, LinearGradient, RadialGradient, Rect, vec } from '@shopify/react-native-skia';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

export type GradientProps = {
  width: number;
  height: number;
  /** Top to bottom, or round (cx, cy) out to r. */
  kind: { linear: string[] } | { radial: string[]; cx: number; cy: number; r: number };
  style?: StyleProp<ViewStyle>;
};

/** A plain gradient (the floor, the desk edge's shadow, a lifted corner). The web draws it with CSS. */
export function Gradient({ width, height, kind, style }: GradientProps) {
  return (
    <View pointerEvents="none" style={[{ width, height }, style]}>
      <Canvas style={StyleSheet.flatten([styles.fill, { width, height }])}>
        <Rect x={0} y={0} width={width} height={height}>
          {'linear' in kind ? (
            <LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={kind.linear} />
          ) : (
            <RadialGradient c={vec(kind.cx, kind.cy)} r={kind.r} colors={kind.radial} />
          )}
        </Rect>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, top: 0 },
});
