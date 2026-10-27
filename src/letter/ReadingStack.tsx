import { Canvas, Group, Picture, Rect, Shadow, Skia, type Transforms3d } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import {
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
import type { FoldKind } from './fold';
import { paperEdgeColor, useSheetFaces, type LetterLook, type SheetFaces } from './LetterSheet';
import { sheetJitter, writtenFaces, type FaceRef, type SheetContent } from './stack';

/**
 * Reading a letter of several sheets, both sides. One value, `turn`, walks the
 * faces in writing order (a float: 1.5 is halfway between the second and third
 * face, the one exception to the app's t ∈ [0, 1]). Between the two faces of a
 * sheet the sheet turns over like a book page; between sheets the read one slides
 * off to the left and is tucked under the stack. A horizontal drag writes `turn`,
 * a release settles on a face with a velocity spring; buttons do the same.
 * Every sheet is baked up front (at most four), so nothing bakes mid-gesture.
 */

const PERSPECTIVE = 1400;
const PAD = 24;

type Props = {
  sheets: SheetContent[];
  look: LetterLook;
  width: number;
  height: number;
  fold: FoldKind;
  /** Width of the desk sheet the pen strokes were drawn on. */
  strokesWidth?: number;
  /** Lab/QA: freeze the stack at this turn. */
  fixedTurn?: number;
  /** Bump to go to the next face (or back with a negative key), as the buttons do. */
  step?: { key: number; dir: 1 | -1 };
  onFace?: (index: number, faces: FaceRef[]) => void;
};

export function ReadingStack({ sheets, look, width, height, fold, strokesWidth, fixedTurn, step, onFace }: Props) {
  const crease = 0.35;
  // A fixed number of hooks: one per possible sheet.
  const s0 = useSheetFaces(sheets[0], 0, look, width, height, crease, fold, strokesWidth);
  const s1 = useSheetFaces(sheets[1], 1, look, width, height, crease, fold, strokesWidth);
  const s2 = useSheetFaces(sheets[2], 2, look, width, height, crease, fold, strokesWidth);
  const s3 = useSheetFaces(sheets[3], 3, look, width, height, crease, fold, strokesWidth);
  const baked = [s0, s1, s2, s3].slice(0, sheets.length);

  const faces = writtenFaces(sheets);
  const last = faces.length - 1;
  // Where each sheet's faces sit on the turn axis.
  const marks = sheets.map((_, i) => {
    const first = faces.findIndex((f) => f.sheet === i);
    const hasBack = faces[first + 1]?.sheet === i;
    return { first, hasBack, done: first + (hasBack ? 1 : 0) };
  });

  const turn = useSharedValue(fixedTurn ?? 0);
  const start = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  const [at, setAt] = useState(Math.round(fixedTurn ?? 0));

  useEffect(() => {
    if (fixedTurn !== undefined) turn.set(fixedTurn);
  }, [fixedTurn, turn]);
  useEffect(() => {
    onFace?.(at, faces);
    // report face changes only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);

  const settle = (target: number, velocity = 0) => {
    'worklet';
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(setAt, target);
    };
    turn.set(
      reduceMotion
        ? withTiming(target, { duration: 0 }, done)
        : withSpring(target, { velocity, damping: 20, stiffness: 150, mass: 0.9 }, done),
    );
  };

  // The buttons.
  useEffect(() => {
    if (!step || fixedTurn !== undefined) return;
    settle(Math.max(0, Math.min(last, Math.round(turn.get()) + step.dir)));
    // only a new key moves the stack
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.key]);

  const travel = width * 0.9;
  const pan = usePanGesture({
    enabled: fixedTurn === undefined && last > 0,
    activeOffsetX: [-12, 12],
    failOffsetY: [-10, 10],
    onBegin: () => {
      start.set(Math.round(turn.get()));
    },
    onUpdate: (e) => {
      const raw = start.get() - e.translationX / travel;
      // Past the first or last face the paper resists.
      const lo = Math.max(0, start.get() - 1);
      const hi = Math.min(last, start.get() + 1);
      turn.set(raw < lo ? lo - (lo - raw) * 0.25 : raw > hi ? hi + (raw - hi) * 0.25 : raw);
    },
    onDeactivate: (e) => {
      const v = -e.velocityX / travel;
      const s = start.get();
      const pushed = v > 0.6 ? s + 1 : v < -0.6 ? s - 1 : Math.round(turn.get());
      settle(Math.max(0, Math.min(last, Math.max(s - 1, Math.min(s + 1, pushed)))), v);
    },
    onFinalize: (e) => {
      // Taken over (the desk scrolled): back to where it was.
      if (e.canceled) settle(start.get());
    },
  });

  // A tick as a sheet's edge passes upright; paper on paper as one slides away.
  useAnimatedReaction(
    () => Math.floor(turn.get() * 2),
    (now, prev) => {
      if (prev === null || now === prev) return;
      const crossed = Math.floor(Math.max(now, prev) / 2);
      const isFlip = marks.some((m) => m.hasBack && m.first === crossed);
      scheduleOnRN(isFlip ? feel.tick : feel.fibre);
    },
  );

  if (baked.some((b) => !b)) return <View style={{ width: width + PAD * 2, height: height + PAD * 2 }} />;
  const ready = baked as SheetFaces[];
  const edge = paperEdgeColor(look.paper);

  return (
    <GestureDetector gesture={pan} touchAction="pan-y">
      <Canvas style={{ width: width + PAD * 2, height: height + PAD * 2 }}>
        <Group transform={[{ translateX: PAD }, { translateY: PAD }]}>
          <Rect x={0} y={0} width={width} height={height} color="#000">
            <Shadow dx={2} dy={6} blur={10} color="rgba(20, 12, 4, 0.35)" shadowOnly />
            <Shadow dx={0} dy={1} blur={1.5} color="rgba(20, 12, 4, 0.4)" shadowOnly />
          </Rect>
          {/* Read sheets, tucked under the stack: only their edges show. */}
          {ready.map((faces, i) => (
            <ReadSheet key={`under${i}`} layer="under" faces={faces} index={i} mark={marks[i]} turn={turn} seed={look.seed} edge={edge} width={width} height={height} />
          ))}
          {/* The stack, the first unread sheet on top. */}
          {ready
            .map((faces, i) => (
              <ReadSheet key={`top${i}`} layer="top" faces={faces} index={i} mark={marks[i]} turn={turn} seed={look.seed} edge={edge} width={width} height={height} />
            ))
            .reverse()}
        </Group>
      </Canvas>
    </GestureDetector>
  );
}

const clamp01 = (x: number) => {
  'worklet';
  return Math.min(1, Math.max(0, x));
};
const ease = (x: number) => {
  'worklet';
  const c = clamp01(x);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};

/**
 * One sheet of the stack. Its turn over runs while `turn` goes from its front to
 * its back; its slide out from its last face to the next sheet's front. It is drawn
 * twice: in the stack (until it is halfway out) and under it (after).
 */
function ReadSheet({
  layer,
  faces,
  index,
  mark,
  turn,
  seed,
  edge,
  width,
  height,
}: {
  layer: 'top' | 'under';
  faces: SheetFaces;
  index: number;
  mark: { first: number; hasBack: boolean; done: number };
  turn: SharedValue<number>;
  seed: number;
  edge: string;
  width: number;
  height: number;
}) {
  const j = sheetJitter(seed, index);
  const EMPTY = Skia.XYWHRect(0, 0, 0, 0);
  const full = Skia.XYWHRect(-3, -3, width + 6, height + 6);

  const angle = useDerivedValue(() => (mark.hasBack ? ease(turn.value - mark.first) * Math.PI : 0));
  const out = useDerivedValue(() => clamp01(turn.value - mark.done));
  const shown = useDerivedValue(() => (layer === 'top' ? out.value <= 0.5 : out.value > 0.5));
  const transform = useDerivedValue<Transforms3d>(() => {
    // Out to the left, clear of the stack at 0.5, then back in underneath.
    const away = Math.sin(Math.PI * ease(out.value));
    return [
      { translateX: j.dx - width * 1.04 * away },
      { translateY: j.dy - height * 0.025 * away },
      { rotate: j.rot * 0.4 - 0.05 * away },
      { perspective: PERSPECTIVE },
      { rotateY: -angle.value },
      { scale: 1 + 0.015 * Math.sin(angle.value) },
    ];
  });
  const clip = useDerivedValue(() => (shown.value ? full : EMPTY));
  const frontClip = useDerivedValue(() => (angle.value < Math.PI / 2 ? full : EMPTY));
  const backClip = useDerivedValue(() => (angle.value >= Math.PI / 2 ? full : EMPTY));
  const shade = useDerivedValue(() => 0.3 * Math.sin(angle.value));
  const lifted = useDerivedValue(() => (layer === 'top' ? Math.sin(Math.PI * ease(out.value)) : 0));

  return (
    <Group clip={clip}>
      <Group origin={{ x: width / 2, y: height / 2 }} transform={transform}>
        {/* Off the stack it casts its own shadow on the desk. */}
        <Rect x={0} y={0} width={width} height={height} color="#000" opacity={lifted}>
          <Shadow dx={3} dy={8} blur={14} color="rgba(20, 12, 4, 0.35)" shadowOnly />
        </Rect>
        <Rect x={0} y={0} width={width} height={height} color={edge} />
        <Rect x={0} y={0} width={width} height={height} color="rgba(30, 18, 8, 0.22)" style="stroke" strokeWidth={0.6} />
        <Group clip={frontClip}>
          <Picture picture={faces.recto} />
        </Group>
        <Group clip={backClip}>
          <Picture picture={faces.versoThrough} />
        </Group>
        <Rect x={0} y={0} width={width} height={height} color="#140c04" opacity={shade} />
      </Group>
    </Group>
  );
}
