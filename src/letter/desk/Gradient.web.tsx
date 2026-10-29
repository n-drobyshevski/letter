import { View } from 'react-native';

import type { GradientProps } from './Gradient';

/** A plain gradient as CSS: no WebGL context for the floor, an edge's shadow or a lifted corner. */
export function Gradient({ width, height, kind, style }: GradientProps) {
  const background =
    'linear' in kind
      ? `linear-gradient(to bottom, ${kind.linear.join(', ')})`
      : `radial-gradient(circle ${kind.r}px at ${kind.cx}px ${kind.cy}px, ${kind.radial.join(', ')})`;
  return (
    <View pointerEvents="none" style={[{ width, height }, style]}>
      <div style={{ position: 'absolute', left: 0, top: 0, width, height, background, pointerEvents: 'none' }} />
    </View>
  );
}
