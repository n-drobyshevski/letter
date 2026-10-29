import { PixelRatio, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Lang } from '../tracking/copy';
import { FrontLabel } from './ApronCanvas';
import { EDGE_SHADOW, keptPicture, layoutKey, recordDrawerBox } from './deskPictures';
import { Gradient } from './Gradient';
import { StaticLayer } from './StaticLayer';
import type { DrawerBoxProps } from './types';

/**
 * One drawer's box (spec §3.2, §5.4): the interior (walls, the bare-oak floor or the pen tray's felt, the
 * items from `drawerSlots`, an empty groove or an ink ring for what is in use) with the front under it.
 * `front.width` × (`depth` + `band.fronts`): the parent places it at (front.x, front.y − depth), where its
 * front covers the apron's closed front pixel for pixel, and moves it by −D·t. One static canvas: only the pen
 * tray redraws, when the pen or bottle in use changes. `lang` adds the front's label (RN Text, as on the apron).
 */
export function DrawerBox({
  drawer,
  layout,
  preset,
  seed,
  inUse,
  lifted,
  lang,
  style,
}: DrawerBoxProps & { lang?: Lang; style?: StyleProp<ViewStyle> }) {
  const f = layout.fronts[drawer];
  const depth = layout.drawers[drawer].depth;
  const height = depth + f.height;
  // Only the pen tray draws what is in use (an empty groove, an ink ring); the paper and envelope drawers
  // look the same whatever was taken (their tick is in the caption), so a pick never redraws them.
  const own = drawer === 'pens' ? [inUse.pen, inUse.ink] : [];
  // The screen's density: the envelopes' liners fade where their fine lines would alias.
  const pr = PixelRatio.get();
  const key = ['drawer', drawer, layoutKey(layout), preset, seed, ...own, lifted ?? '-', pr].join(':');
  return (
    <View pointerEvents="none" style={[{ width: f.width, height }, style]}>
      <StaticLayer
        cacheKey={key}
        width={f.width}
        height={height}
        record={() => keptPicture(key, () => recordDrawerBox(drawer, layout, preset, seed, inUse, lifted, pr))}
        style={styles.fill}
      />
      {lang && <FrontLabel layout={layout} drawer={drawer} lang={lang} preset={preset} x={0} y={depth} />}
    </View>
  );
}

/**
 * The desk edge's shadow falling into an open drawer (50 % → 0 over `depth` pt), for a scene that hangs
 * it under the moving nosing instead of relying on the one each box draws at its top (exact at t = 1).
 */
export function EdgeShadow({
  width,
  depth = EDGE_SHADOW.depth,
  style,
}: {
  width: number;
  depth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  // The same as recordEdgeShadow, as a plain gradient (CSS on the web).
  return (
    <Gradient width={width} height={depth} kind={{ linear: [`rgba(5, 3, 1, ${EDGE_SHADOW.alpha})`, 'rgba(5, 3, 1, 0)'] }} style={style} />
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, top: 0 },
});
