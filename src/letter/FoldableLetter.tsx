import {
  Canvas,
  Group,
  LinearGradient,
  Picture,
  Rect,
  Shadow,
  Skia,
  type SkPicture,
  type Transforms3d,
  vec,
} from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import {
  Easing,
  interpolate,
  useAnimatedReaction,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { feel } from '../lib/haptics';
import { creaseOffsets } from './renderLetter';

/**
 * Tri-fold choreography, driven by a single progress value t ∈ [0, 1]:
 *   0.0 → 0.5  bottom third folds up over the middle
 *   0.5 → 1.0  top third folds down over both
 * The finger writes t directly; on release a velocity-aware spring settles it.
 * Panels are rigid planes hinged at the (seeded, slightly off-third) creases.
 */

const PERSPECTIVE = 1100;
const MAX_ANGLE = Math.PI * 0.985; // a folded sheet never lies perfectly flat

function ease(x: number) {
  'worklet';
  const c = Math.min(1, Math.max(0, x));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

type Props = {
  front: SkPicture;
  /** Paper-only picture used for the back side of folded panels. */
  back: SkPicture;
  width: number;
  height: number;
  seed: number;
  /** Freeze progress (visual QA). */
  fixedT?: number;
  /** Start folded (1) to unfold a received letter. */
  initialT?: number;
  /** Called when a release settles fully open (0) or fully folded (1). */
  onSettled?: (t: 0 | 1) => void;
};

const PAD = 28;

export function FoldableLetter({ front, back, width, height, seed, fixedT, initialT = 0, onSettled }: Props) {
  const [o1, o2] = creaseOffsets(seed);
  const a = height / 3 + o1;
  const b = (height * 2) / 3 + o2;
  const travel = height * 0.75;

  const t = useSharedValue(fixedT ?? initialT);
  const start = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (fixedT !== undefined) t.set(fixedT);
  }, [fixedT, t]);

  const pan = usePanGesture({
    enabled: fixedT === undefined,
    onBegin: () => {
      start.set(t.get());
    },
    onUpdate: (e) => {
      t.set(Math.min(1, Math.max(0, start.get() - e.translationY / travel)));
    },
    onDeactivate: (e) => {
      const v = -e.velocityY / travel;
      const target = v > 0.6 ? 1 : v < -0.6 ? 0 : t.get() > 0.5 ? 1 : 0;
      const done = (finished?: boolean) => {
        'worklet';
        if (finished && onSettled) scheduleOnRN(onSettled, target as 0 | 1);
      };
      t.set(
        reduceMotion
          ? withTiming(target, { duration: 180, easing: Easing.out(Easing.quad) }, done)
          : withSpring(target, { velocity: v, damping: 20, stiffness: 150, mass: 0.9 }, done),
      );
    },
  });

  // A crease "click" each time a panel lands.
  useAnimatedReaction(
    () => (t.value > 0.49 ? 1 : 0) + (t.value > 0.985 ? 1 : 0),
    (now, prev) => {
      if (prev !== null && now > prev) scheduleOnRN(feel.crease);
    },
  );

  const bottomAngle = useDerivedValue(() => ease(t.value / 0.5) * MAX_ANGLE);
  const topAngle = useDerivedValue(() => ease((t.value - 0.5) / 0.5) * MAX_ANGLE);

  const bottomTransform = useDerivedValue<Transforms3d>(() => [
    { perspective: PERSPECTIVE },
    { rotateX: -bottomAngle.value },
  ]);
  const topTransform = useDerivedValue<Transforms3d>(() => [
    { perspective: PERSPECTIVE },
    { rotateX: topAngle.value },
  ]);

  // Which face of a hinged panel is visible. Done with clips, not opacity:
  // group opacity does not apply to drawPicture without a layer.
  const EMPTY = Skia.XYWHRect(0, 0, 0, 0);
  const bottomRect = Skia.XYWHRect(0, b, width, height - b);
  const topRect = Skia.XYWHRect(0, 0, width, a);
  const bottomFrontClip = useDerivedValue(() => (bottomAngle.value < Math.PI / 2 ? bottomRect : EMPTY));
  const bottomBackClip = useDerivedValue(() => (bottomAngle.value < Math.PI / 2 ? EMPTY : bottomRect));
  const topFrontClip = useDerivedValue(() => (topAngle.value < Math.PI / 2 ? topRect : EMPTY));
  const topBackClip = useDerivedValue(() => (topAngle.value < Math.PI / 2 ? EMPTY : topRect));

  // Light: a panel turning away from the desk lamp darkens; its back catches light as it lands.
  const bottomShade = useDerivedValue(() => 0.22 * Math.sin(bottomAngle.value));
  const topShade = useDerivedValue(() => 0.22 * Math.sin(topAngle.value));
  // The moving panel casts a shadow on what lies beneath it.
  const middleShadow = useDerivedValue(() =>
    interpolate(bottomAngle.value, [0, Math.PI * 0.6, MAX_ANGLE], [0, 0.18, 0.08]),
  );
  // The back of the bottom panel faces the lamp once it lands.
  const backLight = useDerivedValue(() => 0.06 * Math.max(0, -Math.cos(bottomAngle.value)) * (1 - topAngle.value / Math.PI));
  const stackShadow = useDerivedValue(() =>
    interpolate(topAngle.value, [0, Math.PI * 0.6, MAX_ANGLE], [0, 0.2, 0.1]),
  );

  // Recentre the shrinking stack so the folded letter ends in the middle of the canvas.
  const lift = useDerivedValue(() => [
    { translateX: PAD },
    { translateY: PAD + interpolate(t.value, [0, 0.5, 1], [0, (height - b) / 2, height / 3]) },
  ]);

  const contactRect = useDerivedValue(() => {
    const top = a - a * Math.max(0, Math.cos(topAngle.value));
    const bottom = b + (height - b) * Math.max(0, Math.cos(bottomAngle.value));
    return Skia.XYWHRect(0, top, width, bottom - top);
  });

  const middleClip = Skia.XYWHRect(0, a, width, b - a);
  // Ink seen through the paper from the other side (the flip already mirrors it).
  const showThrough = Skia.Paint();
  showThrough.setAlphaf(0.08);

  return (
    <GestureDetector gesture={pan}>
      <Canvas style={{ width: width + PAD * 2, height: height + PAD * 2 }}>
        <Group transform={lift}>
          {/* contact shadow: follows the part of the sheet still touching the desk */}
          <Rect rect={contactRect} color="#000">
            <Shadow dx={2} dy={6} blur={10} color="rgba(20, 12, 4, 0.35)" shadowOnly />
          </Rect>

          {/* middle third: never moves */}
          <Group clip={middleClip}>
            <Picture picture={front} />
            <Rect x={0} y={a} width={width} height={b - a} opacity={middleShadow}>
              <LinearGradient start={vec(0, b)} end={vec(0, a)} colors={['#140c04', 'rgba(20,12,4,0.25)']} />
            </Rect>
          </Group>

          {/* bottom third, hinged at b */}
          <Group origin={{ x: width / 2, y: b }} transform={bottomTransform}>
            <Group clip={bottomFrontClip}>
              <Picture picture={front} />
              <Rect x={0} y={b} width={width} height={height - b} color="#140c04" opacity={bottomShade} />
            </Group>
            <Group clip={bottomBackClip}>
              <Picture picture={back} />
              <Group layer={showThrough}>
                <Picture picture={front} />
              </Group>
              <Rect x={0} y={b} width={width} height={height - b} color="#fff8ec" opacity={backLight} />
            </Group>
          </Group>

          <Rect x={0} y={a} width={width} height={b - a} opacity={stackShadow}>
            <LinearGradient start={vec(0, a)} end={vec(0, b)} colors={['#140c04', 'rgba(20,12,4,0.3)']} />
          </Rect>

          {/* top third, hinged at a */}
          <Group origin={{ x: width / 2, y: a }} transform={topTransform}>
            <Group clip={topFrontClip}>
              <Picture picture={front} />
              <Rect x={0} y={0} width={width} height={a} color="#140c04" opacity={topShade} />
            </Group>
            <Group clip={topBackClip}>
              <Picture picture={back} />
              <Group layer={showThrough}>
                <Picture picture={front} />
              </Group>
            </Group>
          </Group>
        </Group>
      </Canvas>
    </GestureDetector>
  );
}
