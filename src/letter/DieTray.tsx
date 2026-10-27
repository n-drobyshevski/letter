import { Canvas, Circle, Group, RadialGradient, vec, type SkFont } from '@shopify/react-native-skia';
import { useEffect, useRef, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { WAX, type WaxKind } from '../theme/stationery';
import { DieMark } from './DieChip';
import { SEAL_DIE_ORDER, SEAL_DIES, type SealDie } from './sealDies';

/** Chip size and gap (pt): 44 pt touch targets, 8 pt apart. */
export const CHIP = 44;
const GAP = 8;
/** The picked chip lifts this much, with a brass ring. */
const LIFT = 2;
const H = CHIP + 4;
const PAD_X = 4;
/** The die mark's size in a chip (px across); useDieMarkFont(initials, TRAY_MARK) preloads its font. */
export const TRAY_MARK = 25;

const rgb = (c: readonly number[], k = 1, a = 1) =>
  `rgba(${Math.round(Math.min(1, c[0] * k) * 255)}, ${Math.round(Math.min(1, c[1] * k) * 255)}, ${Math.round(Math.min(1, c[2] * k) * 255)}, ${a})`;

export const dieLabel = (die: SealDie, lang: 'ru' | 'fr') => (lang === 'fr' ? SEAL_DIES[die].labelFr : SEAL_DIES[die].label);

/**
 * The seal dies to pick from, as small wax impressions in the current wax colour (a
 * stationer's sample card): one row of 44 pt chips that scrolls sideways on narrow phones.
 * Drawn in a single Canvas (each web Canvas is a GL context); the touch targets are plain
 * Pressables laid over it.
 */
export function DieTray({
  die,
  wax,
  initials,
  lang = 'ru',
  width: room,
  disabled = false,
  font,
  onPick,
}: {
  die: SealDie;
  wax: WaxKind;
  initials: string;
  lang?: 'ru' | 'fr';
  /** How much room the row has (pt); it scrolls when the chips need more. */
  width: number;
  disabled?: boolean;
  /** The monogram chip's font, preloaded by the screen (useDieMarkFont(initials, TRAY_MARK)). */
  font?: SkFont | null;
  onPick: (die: SealDie) => void;
}) {
  const width = SEAL_DIE_ORDER.length * CHIP + (SEAL_DIE_ORDER.length - 1) * GAP;
  const shown = Math.min(room, width + PAD_X * 2);
  const c = WAX[wax].rgb;
  // The picked die is always in view: on a narrow phone a die picked elsewhere (a draft
  // sealed before, ?die=) may sit past the edge. One picked by hand already is in view.
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const offset = useRef(0);
  const reveal = () => {
    const i = SEAL_DIE_ORDER.indexOf(die);
    const left = PAD_X + i * (CHIP + GAP);
    if (left >= offset.current && left + CHIP <= offset.current + shown) return;
    const x = Math.max(0, Math.min(width + PAD_X * 2 - shown, left - (shown - CHIP) / 2));
    offset.current = x;
    scroller.current?.scrollTo({ x, animated: false });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reveal, [die, shown]);
  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ width: shown, flexGrow: 0 }}
      contentContainerStyle={styles.content}
      onContentSizeChange={reveal}
      onScroll={(e) => {
        offset.current = e.nativeEvent.contentOffset.x;
      }}
      scrollEventThrottle={32}
    >
      <View style={{ width, height: H }}>
        <Canvas style={{ width, height: H }}>
          {SEAL_DIE_ORDER.map((d, i) => {
            const on = d === die;
            const cx = i * (CHIP + GAP) + CHIP / 2;
            const cy = H / 2 + (on ? -LIFT : 0);
            return (
              <Group key={d}>
                {/* the little wax sample under the impression, a soft shadow down-right */}
                <Circle cx={cx + 1} cy={cy + 1.6 + (on ? LIFT : 0)} r={16.5} color="rgba(10, 5, 2, 0.35)" />
                <Circle cx={cx} cy={cy} r={16.5}>
                  <RadialGradient c={vec(cx - 5, cy - 7)} r={22} colors={[rgb(c, 1.35), rgb(c), rgb(c, 0.62)]} />
                </Circle>
                <DieMark die={d} wax={wax} cx={cx} cy={cy} size={TRAY_MARK} initials={initials} font={font} />
                {on && <Circle cx={cx} cy={cy} r={19.5} style="stroke" strokeWidth={1.6} color="#c49a45" />}
              </Group>
            );
          })}
        </Canvas>
        <View style={StyleSheet.absoluteFill}>
          {SEAL_DIE_ORDER.map((d, i) => (
            <Pressable
              key={d}
              disabled={disabled}
              onPress={() => d !== die && onPick(d)}
              style={[styles.hit, { left: i * (CHIP + GAP) }]}
              accessibilityRole="button"
              accessibilityLabel={dieLabel(d, lang)}
              accessibilityState={{ selected: d === die, disabled }}
            />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: PAD_X },
  hit: { position: 'absolute', top: 0, width: CHIP, height: H },
});
