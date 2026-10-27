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
import { useEffect, useState } from 'react';
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
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { feel } from '../lib/haptics';
import { foldLines, type FoldKind } from './fold';
import { sheetJitter } from './stack';

/**
 * Folding a letter, with the gesture choosing the fold:
 *   drag up from below          → tri-fold: bottom third up (t 0 → 0.5), top third down (0.5 → 1)
 *   pull the top edge down      → half fold: the top half comes down over the bottom (h 0 → 1)
 *   then swipe left             → quarter fold: the right half over the left (q 0 → 1)
 * Each fold is one progress value the finger writes directly; on release a
 * velocity-aware spring settles it. Panels are rigid planes hinged at seeded,
 * slightly-off creases. Unfolding is the same gestures backwards.
 * With `kind` set (a received letter) only that fold's gestures apply.
 */

const PERSPECTIVE = 1100;
const MAX_ANGLE = Math.PI * 0.985; // a folded sheet never lies perfectly flat

function ease(x: number) {
  'worklet';
  const c = Math.min(1, Math.max(0, x));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

type Props = {
  /** The top sheet's recto (face view). */
  front: SkPicture;
  /**
   * The back of the stack (the last sheet's verso, through view: in the front's
   * coordinates, its other face showing through), seen on folded panels.
   */
  back: SkPicture;
  /** Sheets folded together; the ones under the top show only as edges. */
  sheets?: number;
  /** Colour of the paper's cut edge, for those under-sheets. */
  edgeColor?: string;
  /** Whether a sideways swipe may fold it once more, in four (two sheets at most). */
  allowQuarter?: boolean;
  width: number;
  height: number;
  seed: number;
  /** A fixed fold (a received letter, QA). Without it the first gesture chooses. */
  kind?: FoldKind;
  /** Freeze progress (visual QA). For the quarter fold, 0–0.5 is the half fold and 0.5–1 the second fold. */
  fixedT?: number;
  /** Start folded (1) to unfold a received letter. */
  initialT?: number;
  /** Called when a release settles fully open (0) or folded (1), with the fold it settled in. */
  onSettled?: (t: 0 | 1, kind: FoldKind) => void;
  /** The fold the gesture chose (or null once the sheet lies open again and no fold is fixed). */
  onKind?: (kind: FoldKind | null) => void;
};

const PAD = 28;
// Gesture modes (worklet-side): which fold the current hand is making.
const NONE = 0;
const TRI = 1;
const HALF = 2;
// Axis locked for one gesture in HALF mode.
const AXIS_H = 1;
const AXIS_Q = 2;

const split = (kind: FoldKind | undefined, v: number) => ({
  t: kind === 'tri' || kind === undefined ? v : 0,
  h: kind === 'half' ? v : kind === 'quarter' ? Math.min(1, v * 2) : 0,
  q: kind === 'quarter' ? Math.max(0, v * 2 - 1) : 0,
});

export function FoldableLetter({
  front,
  back,
  sheets = 1,
  edgeColor = '#e9e1d0',
  allowQuarter = true,
  width,
  height,
  seed,
  kind,
  fixedT,
  initialT = 0,
  onSettled,
  onKind,
}: Props) {
  const init = split(kind, fixedT ?? initialT);
  const t = useSharedValue(init.t);
  const h = useSharedValue(init.h);
  const q = useSharedValue(init.q);
  const mode = useSharedValue(kind === undefined ? (init.t > 0 ? TRI : NONE) : kind === 'tri' ? TRI : HALF);
  const axis = useSharedValue(0);
  const start = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  // Which set of panels is drawn. Switching happens only while the sheet is flat.
  const [drawn, setDrawn] = useState<'tri' | 'half'>(kind === 'half' || kind === 'quarter' ? 'half' : 'tri');

  useEffect(() => {
    if (fixedT === undefined) return;
    const v = split(kind, fixedT);
    t.set(v.t);
    h.set(v.h);
    q.set(v.q);
  }, [fixedT, kind, t, h, q]);

  const choose = (k: 'tri' | 'half') => {
    setDrawn(k);
    onKind?.(k);
  };
  const report = (target: 0 | 1, k: FoldKind) => {
    onSettled?.(target, k);
    if (kind === undefined) onKind?.(target === 0 && k !== 'quarter' ? null : k);
  };

  const travelT = height * 0.75;
  const travelH = height * 0.8;
  const travelQ = width * 0.8;

  const pan = usePanGesture({
    enabled: fixedT === undefined,
    onBegin: () => {
      axis.set(0);
    },
    onUpdate: (e) => {
      // The first clear movement on a flat sheet decides the fold.
      if (mode.get() === NONE) {
        if (Math.hypot(e.translationX, e.translationY) < 10) return;
        if (Math.abs(e.translationY) < Math.abs(e.translationX)) return;
        if (e.translationY < 0) {
          mode.set(TRI);
          start.set(t.get());
          scheduleOnRN(choose, 'tri');
        } else {
          mode.set(HALF);
          start.set(h.get());
          axis.set(AXIS_H);
          scheduleOnRN(choose, 'half');
        }
      }
      if (mode.get() === TRI) {
        if (axis.get() === 0) {
          axis.set(AXIS_H);
          start.set(t.get());
        }
        t.set(Math.min(1, Math.max(0, start.get() - e.translationY / travelT)));
        return;
      }
      if (mode.get() !== HALF) return;
      if (axis.get() === 0) {
        // Folded in half and nothing more: sideways folds again, vertical unfolds.
        if (Math.hypot(e.translationX, e.translationY) < 10) return;
        const sideways = Math.abs(e.translationX) > Math.abs(e.translationY);
        if (q.get() > 0.001 || (h.get() > 0.999 && sideways && kind !== 'half' && allowQuarter)) {
          axis.set(AXIS_Q);
          start.set(q.get());
        } else {
          axis.set(AXIS_H);
          start.set(h.get());
        }
      }
      if (axis.get() === AXIS_H) h.set(Math.min(1, Math.max(0, start.get() + e.translationY / travelH)));
      else q.set(Math.min(1, Math.max(0, start.get() - e.translationX / travelQ)));
    },
    onDeactivate: (e) => {
      const m = mode.get();
      if (m === NONE) return;
      const isQ = m === HALF && axis.get() === AXIS_Q;
      const value = m === TRI ? t : isQ ? q : h;
      const v = m === TRI ? -e.velocityY / travelT : isQ ? -e.velocityX / travelQ : e.velocityY / travelH;
      const target: 0 | 1 = v > 0.6 ? 1 : v < -0.6 ? 0 : value.get() > 0.5 ? 1 : 0;
      const k: FoldKind = m === TRI ? 'tri' : isQ ? (target === 1 ? 'quarter' : 'half') : 'half';
      // Back to a flat sheet: the next gesture may choose again.
      const free = kind === undefined && target === 0 && !isQ;
      if (free) mode.set(NONE);
      const settledAt: 0 | 1 = isQ ? 1 : target;
      const done = (finished?: boolean) => {
        'worklet';
        if (finished) scheduleOnRN(report, settledAt, k);
      };
      value.set(
        reduceMotion
          ? withTiming(target, { duration: 180, easing: Easing.out(Easing.quad) }, done)
          : withSpring(target, { velocity: v, damping: 20, stiffness: 150, mass: 0.9 }, done),
      );
    },
  });

  // A crease "click" each time a panel lands.
  useAnimatedReaction(
    () => (t.get() > 0.49 ? 1 : 0) + (t.get() > 0.985 ? 1 : 0) + (h.get() > 0.985 ? 1 : 0) + (q.get() > 0.985 ? 1 : 0),
    (now, prev) => {
      if (prev !== null && now > prev) scheduleOnRN(feel.crease);
    },
  );

  const under = sheets > 1 ? <UnderSheets sheets={sheets} seed={seed} width={width} height={height} color={edgeColor} /> : null;

  return (
    <GestureDetector gesture={pan}>
      <Canvas style={{ width: width + PAD * 2, height: height + PAD * 2 }}>
        {drawn === 'tri' ? (
          <TriFold front={front} back={back} under={under} width={width} height={height} seed={seed} t={t} />
        ) : (
          <HalfFold front={front} back={back} under={under} width={width} height={height} seed={seed} h={h} q={q} />
        )}
      </Canvas>
    </GestureDetector>
  );
}

type Layers = { front: SkPicture; back: SkPicture; under: React.ReactNode; width: number; height: number; seed: number };

// Panel clips reach this far past the sheet's outer edges, so the sheets beneath can peek out.
const EDGE = 3;

/**
 * The sheets under the top one, folded with it: never quite aligned, so their cut
 * edges show as hairlines around each panel. Drawn beneath a panel's face, inside
 * its group, so they turn with it.
 */
function UnderSheets({ sheets, seed, width, height, color }: { sheets: number; seed: number; width: number; height: number; color: string }) {
  return (
    <>
      {Array.from({ length: sheets - 1 }, (_, i) => {
        const j = sheetJitter(seed, i + 1);
        return (
          <Group
            key={i}
            origin={{ x: width / 2, y: height / 2 }}
            transform={[{ translateX: j.dx }, { translateY: j.dy }, { rotate: j.rot * 0.4 }]}
          >
            <Rect x={0} y={0} width={width} height={height} color={color} />
            <Rect x={0} y={0} width={width} height={height} color="rgba(30, 18, 8, 0.22)" style="stroke" strokeWidth={0.6} />
          </Group>
        );
      })}
    </>
  );
}

/** Letter fold in thirds: bottom third up over the middle, then the top third down over both. */
function TriFold({ front, back, under, width, height, seed, t }: Layers & { t: SharedValue<number> }) {
  const [a, b] = foldLines('tri', width, height, seed).ys;

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
  // Panels overlap the middle by a pixel: antialiased clip edges meeting exactly leave a seam.
  const bottomRect = Skia.XYWHRect(-EDGE, b - 1, width + EDGE * 2, height - b + 1 + EDGE);
  const topRect = Skia.XYWHRect(-EDGE, -EDGE, width + EDGE * 2, a + 1 + EDGE);
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

  const middleClip = Skia.XYWHRect(-EDGE, a, width + EDGE * 2, b - a);

  return (
    <Group transform={lift}>
      {/* contact shadow: follows the part of the sheet still touching the desk */}
      <Rect rect={contactRect} color="#000">
        <Shadow dx={2} dy={6} blur={10} color="rgba(20, 12, 4, 0.35)" shadowOnly />
      </Rect>

      {/* middle third: never moves */}
      <Group clip={middleClip}>
        {under}
        <Picture picture={front} />
        <Rect x={0} y={a} width={width} height={b - a} opacity={middleShadow}>
          <LinearGradient start={vec(0, b)} end={vec(0, a)} colors={['#140c04', 'rgba(20,12,4,0.25)']} />
        </Rect>
      </Group>

      {/* bottom third, hinged at b */}
      <Group origin={{ x: width / 2, y: b }} transform={bottomTransform}>
        <Group clip={bottomFrontClip}>
          {under}
          <Picture picture={front} />
          <Rect x={0} y={b} width={width} height={height - b} color="#140c04" opacity={bottomShade} />
        </Group>
        <Group clip={bottomBackClip}>
          {under}
          <Picture picture={back} />
          <Rect x={0} y={b} width={width} height={height - b} color="#fff8ec" opacity={backLight} />
        </Group>
      </Group>

      <Rect x={0} y={a} width={width} height={b - a} opacity={stackShadow}>
        <LinearGradient start={vec(0, a)} end={vec(0, b)} colors={['#140c04', 'rgba(20,12,4,0.3)']} />
      </Rect>

      {/* top third, hinged at a */}
      <Group origin={{ x: width / 2, y: a }} transform={topTransform}>
        <Group clip={topFrontClip}>
          {under}
          <Picture picture={front} />
          <Rect x={0} y={0} width={width} height={a} color="#140c04" opacity={topShade} />
        </Group>
        <Group clip={topBackClip}>
          {under}
          <Picture picture={back} />
        </Group>
      </Group>
    </Group>
  );
}

/**
 * Half fold (top half down over the bottom, crease at m) and, from there, the
 * quarter fold: the right half of that two-layer stack swings over the left
 * about the vertical crease at x.
 */
function HalfFold({ front, back, under, width, height, seed, h, q }: Layers & { h: SharedValue<number>; q: SharedValue<number> }) {
  const lines = foldLines('quarter', width, height, seed);
  const m = lines.ys[0];
  const x = lines.x!;

  const topAngle = useDerivedValue(() => ease(h.value) * MAX_ANGLE);
  const sideAngle = useDerivedValue(() => ease(q.value) * MAX_ANGLE);

  const topTransform = useDerivedValue<Transforms3d>(() => [{ perspective: PERSPECTIVE }, { rotateX: topAngle.value }]);
  const sideTransform = useDerivedValue<Transforms3d>(() => [{ perspective: PERSPECTIVE }, { rotateY: -sideAngle.value }]);

  const EMPTY = Skia.XYWHRect(0, 0, 0, 0);
  const topRect = Skia.XYWHRect(-EDGE, -EDGE, width + EDGE * 2, m + 1 + EDGE);
  const topFrontClip = useDerivedValue(() => (topAngle.value < Math.PI / 2 ? topRect : EMPTY));
  const topBackClip = useDerivedValue(() => (topAngle.value < Math.PI / 2 ? EMPTY : topRect));

  // The two halves overlap by a pixel: antialiased clip edges meeting exactly leave a seam.
  const left = Skia.XYWHRect(-width, -height, x + width + 1, height * 3);
  const right = Skia.XYWHRect(x, -height, width * 2, height * 3);
  const rightBack = Skia.XYWHRect(x, m, width - x + EDGE, height - m + EDGE);
  const sideFrontClip = useDerivedValue(() => (sideAngle.value < Math.PI / 2 ? right : EMPTY));
  const sideBackClip = useDerivedValue(() => (sideAngle.value < Math.PI / 2 ? EMPTY : rightBack));

  const topShade = useDerivedValue(() => 0.22 * Math.sin(topAngle.value));
  const sideShade = useDerivedValue(() => 0.18 * Math.sin(sideAngle.value));
  const bottomShadow = useDerivedValue(() => interpolate(topAngle.value, [0, Math.PI * 0.6, MAX_ANGLE], [0, 0.2, 0.09]));
  const leftShadow = useDerivedValue(() => interpolate(sideAngle.value, [0, Math.PI * 0.6, MAX_ANGLE], [0, 0.2, 0.09]));
  // The back of the bottom half faces the lamp once it lands on the left.
  const backLight = useDerivedValue(() => 0.05 * Math.max(0, -Math.cos(sideAngle.value)));

  // Recentre: the stack ends as the lower half, then as its left half.
  const lift = useDerivedValue(() => [
    { translateX: PAD + ((width - x) / 2) * ease(q.value) },
    { translateY: PAD - (m / 2) * ease(h.value) },
  ]);

  const contactRect = useDerivedValue(() => {
    const top = m - m * Math.max(0, Math.cos(topAngle.value));
    const right = x + (width - x) * Math.max(0, Math.cos(sideAngle.value));
    return Skia.XYWHRect(0, top, right, height - top);
  });

  // The half-folded stack: the bottom half, and the top half hinged at m on top of it.
  const stack = (
    <>
      <Group clip={Skia.XYWHRect(-EDGE, m, width + EDGE * 2, height - m + EDGE)}>
        {under}
        <Picture picture={front} />
        <Rect x={0} y={m} width={width} height={height - m} opacity={bottomShadow}>
          <LinearGradient start={vec(0, m)} end={vec(0, height)} colors={['#140c04', 'rgba(20,12,4,0.25)']} />
        </Rect>
      </Group>
      <Group origin={{ x: width / 2, y: m }} transform={topTransform}>
        <Group clip={topFrontClip}>
          {under}
          <Picture picture={front} />
          <Rect x={0} y={0} width={width} height={m} color="#140c04" opacity={topShade} />
        </Group>
        <Group clip={topBackClip}>
          {under}
          <Picture picture={back} />
        </Group>
      </Group>
    </>
  );

  return (
    <Group transform={lift}>
      <Rect rect={contactRect} color="#000">
        <Shadow dx={2} dy={6} blur={10} color="rgba(20, 12, 4, 0.35)" shadowOnly />
      </Rect>

      {/* left half of the stack: never moves */}
      <Group clip={left}>
        {stack}
        <Rect x={0} y={m} width={x} height={height - m} opacity={leftShadow}>
          <LinearGradient start={vec(x, 0)} end={vec(0, 0)} colors={['#140c04', 'rgba(20,12,4,0.25)']} />
        </Rect>
      </Group>

      {/* right half of the stack, hinged at x: its top layer, then (turned over) the back of the bottom half */}
      <Group origin={{ x, y: (m + height) / 2 }} transform={sideTransform}>
        <Group clip={sideFrontClip}>
          {stack}
          <Rect x={x} y={m} width={width - x} height={height - m} color="#140c04" opacity={sideShade} />
        </Group>
        <Group clip={sideBackClip}>
          {under}
          <Picture picture={back} />
          <Rect x={x} y={m} width={width - x} height={height - m} color="#fff8ec" opacity={backLight} />
        </Group>
      </Group>
    </Group>
  );
}
