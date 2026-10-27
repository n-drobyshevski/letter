import { Canvas, Group, Image, Picture, Rect, Skia, type Transforms3d } from '@shopify/react-native-skia';
import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { GestureDetector, PointerType, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
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
import { useDeskKeys } from '../lib/useDeskKeys';
import { HOME, dragPlacement, type Placement } from './deskMove';
import type { FoldKind } from './fold';
import { gripOf, type Grip } from './grip';
import { paperEdgeColor, useSheetFaces, type LetterLook, type SheetFaces } from './LetterSheet';
import { useShadow, type ShadowSpec } from './raster';
import { sheetJitter, writtenFaces, type FaceRef, type SheetContent } from './stack';

/**
 * Reading a letter of several sheets, both sides. One value, `turn`, walks the
 * faces in writing order (a float: 1.5 is halfway between the second and third
 * face, the one exception to the app's t ∈ [0, 1]). Between the two faces of a
 * sheet the sheet turns over like a book page; between sheets the read one slides
 * off and is tucked under the stack. A horizontal drag writes `turn`, a release
 * settles on a face with a velocity spring; buttons do the same, square.
 * The turn follows the hand as at the desk (grip.ts): its axis leans with the
 * drag's direction and where the sheet was taken, the sheet travels with the
 * hand, and a read sheet slides off (and a previous one comes back) the way it
 * was pushed. On the laptop, with a mouse, Ctrl (⌘) + drag turns it and Space + drag
 * pushes the letter about the desk (deskMove.ts); a plain drag does nothing.
 * Every sheet is baked up front (at most four), so nothing bakes mid-gesture.
 */

const PERSPECTIVE = 1400;
const PAD = 24;
// The stack on the desk, and a sheet off it (baked once: raster.ts).
const STACK_SHADOW: ShadowSpec[] = [
  { dx: 2, dy: 6, blur: 10, color: 'rgba(20, 12, 4, 0.35)' },
  { dx: 0, dy: 1, blur: 1.5, color: 'rgba(20, 12, 4, 0.4)' },
];
const LIFTED_SHADOW: ShadowSpec[] = [{ dx: 3, dy: 8, blur: 14, color: 'rgba(20, 12, 4, 0.35)' }];
// The laptop (web): a mouse pushes the letter about, Ctrl (⌘) + drag turns it.
const web = Platform.OS === 'web';

type Props = {
  sheets: SheetContent[];
  look: LetterLook;
  width: number;
  height: number;
  fold: FoldKind;
  /** Width of the desk sheet the pen strokes were drawn on. */
  strokesWidth?: number;
  /** Lab/QA: freeze the stack at this turn, and lean that turn's axis (rad). */
  fixedTurn?: number;
  fixedTilt?: number;
  /** Bump to go to the next face (or back with a negative key), as the buttons do. */
  step?: { key: number; dir: 1 | -1 };
  onFace?: (index: number, faces: FaceRef[]) => void;
};

export function ReadingStack({ sheets, look, width, height, fold, strokesWidth, fixedTurn, fixedTilt, step, onFace }: Props) {
  const crease = 0.35;
  // A fixed number of hooks: one per possible sheet.
  const s0 = useSheetFaces(sheets[0], 0, look, width, height, crease, fold, strokesWidth);
  const s1 = useSheetFaces(sheets[1], 1, look, width, height, crease, fold, strokesWidth);
  const s2 = useSheetFaces(sheets[2], 2, look, width, height, crease, fold, strokesWidth);
  const s3 = useSheetFaces(sheets[3], 3, look, width, height, crease, fold, strokesWidth);
  const baked = [s0, s1, s2, s3].slice(0, sheets.length);
  const stackShadow = useShadow({ width, height }, STACK_SHADOW);
  const liftedShadow = useShadow({ width, height }, LIFTED_SHADOW);

  const faces = writtenFaces(sheets);
  const last = faces.length - 1;
  // Where each sheet's faces sit on the turn axis.
  const marks = sheets.map((_, i) => {
    const first = faces.findIndex((f) => f.sheet === i);
    const hasBack = faces[first + 1]?.sheet === i;
    return { first, hasBack, done: first + (hasBack ? 1 : 0) };
  });

  const turn = useSharedValue(fixedTurn ?? 0);
  // Where the drag took hold of the stack (live), and the face it started from.
  const grab = useSharedValue(0);
  const origin = useSharedValue(0);
  // How the hand holds the sheet that moves (square for the buttons), and where it took it.
  const grip = useSharedValue<Grip>({ tilt: fixedTilt ?? 0, ux: -1, uy: 0 });
  const grabY = useSharedValue(0.5);
  const reduceMotion = useReducedMotion();
  const [at, setAt] = useState(Math.round(fixedTurn ?? 0));

  useEffect(() => {
    if (fixedTurn !== undefined) turn.set(fixedTurn);
    if (fixedTilt !== undefined) grip.set({ tilt: fixedTilt, ux: -Math.cos(fixedTilt), uy: Math.sin(fixedTilt) });
  }, [fixedTurn, fixedTilt, turn, grip]);
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

  // The buttons. A press made before this letter was on the desk is not for it.
  const stepAtMount = useRef(step?.key);
  useEffect(() => {
    if (!step || step.key === stepAtMount.current || fixedTurn !== undefined) return;
    grip.set({ tilt: 0, ux: -step.dir, uy: 0 });
    settle(Math.max(0, Math.min(last, Math.round(turn.get()) + step.dir)));
    // only a new key moves the stack
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.key]);

  const travel = width * 0.9;
  const room = Math.round(height * 0.12);
  const keys = useDeskKeys();
  const moving = useSharedValue(false);
  // A plain mouse drag: neither turn nor move.
  const idle = useSharedValue(false);
  const place = useSharedValue<Placement>(HOME);
  const placeAtGrab = useSharedValue<Placement>(HOME);
  const grabAt = useSharedValue({ x: 0, y: 0 });
  const pan = usePanGesture({
    // On the laptop a single sheet can still be pushed about.
    enabled: fixedTurn === undefined && (web || last > 0),
    // A mouse moves the letter any way; on the phone a mostly vertical drag still scrolls
    // the desk, and one that starts sideways turns, at any angle after.
    activeOffsetX: web ? [-8, 8] : [-12, 12],
    activeOffsetY: web ? [-8, 8] : undefined,
    failOffsetY: web ? undefined : [-30, 30],
    onBegin: (e) => {
      grabY.set(Math.min(1, Math.max(0, (e.y - PAD - room) / height)));
      grabAt.set({ x: e.x - PAD - width / 2, y: e.y - PAD - room - height / 2 });
    },
    onActivate: (e) => {
      const mouse = e.pointerType === PointerType.MOUSE;
      moving.set(mouse && keys.move.get());
      idle.set(mouse && !keys.move.get() && !keys.turn.get());
      if (idle.get()) return;
      if (moving.get()) {
        placeAtGrab.set(place.get());
        return;
      }
      // Catch the sheet where it is, even mid-spring.
      cancelAnimation(turn);
      grab.set(turn.get());
      origin.set(Math.round(turn.get()));
    },
    onUpdate: (e) => {
      if (idle.get()) return;
      if (moving.get()) {
        place.set(dragPlacement(placeAtGrab.get(), grabAt.get(), { x: e.translationX, y: e.translationY }, { width, height }));
        return;
      }
      const raw = grab.get() - e.translationX / travel;
      // One face per gesture; past the first or last face the paper resists.
      const lo = Math.max(0, origin.get() - 1);
      const hi = Math.min(last, origin.get() + 1);
      turn.set(raw < lo ? lo - (lo - raw) * 0.25 : raw > hi ? hi + (raw - hi) * 0.25 : raw);
      // Leftward reads on (as the right edge taken at the desk), rightward goes back.
      if (e.translationX !== 0) grip.set(gripOf(e.translationX < 0 ? 1 : -1, e.translationX, e.translationY, grabY.get()));
    },
    onDeactivate: (e) => {
      // A pushed letter stays where it is let go.
      if (idle.get()) return idle.set(false);
      if (moving.get()) return moving.set(false);
      const s = origin.get();
      // Taken over (the desk scrolled): back to where it was.
      if (e.canceled) return settle(s);
      const v = -e.velocityX / travel;
      const pushed = v > 0.6 ? s + 1 : v < -0.6 ? s - 1 : Math.round(turn.get());
      settle(Math.max(0, Math.min(last, Math.max(s - 1, Math.min(s + 1, pushed)))), v);
    },
  });

  const placed = useAnimatedStyle(() => ({
    transform: [{ translateX: place.value.x }, { translateY: place.value.y }, { rotate: `${place.value.rot}rad` }],
  }));

  // Halfway between two faces: a tick as a sheet's edge passes upright, paper on paper as one slides away;
  // the face under the reader's eyes is the new one from there (not once the spring has quite settled).
  useAnimatedReaction(
    () => Math.round(turn.get()),
    (now, prev) => {
      if (prev === null || now === prev) return;
      if (now >= 0 && now <= last) scheduleOnRN(setAt, now);
      const k = Math.min(now, prev);
      const isFlip = marks.some((m) => m.hasBack && m.first === k);
      scheduleOnRN(isFlip ? feel.tick : feel.fibre);
    },
  );

  if (baked.some((b) => !b)) return <View style={{ width: width + PAD * 2, height: height + PAD * 2 }} />;
  const ready = baked as SheetFaces[];
  const edge = paperEdgeColor(look.paper);

  return (
    // Room above and below for a leaning turn, without moving the layout around it.
    <Animated.View style={[{ marginVertical: -room }, placed, web && ({ cursor: 'grab' } as object)]}>
      <GestureDetector gesture={pan} touchAction="pan-y">
        <Canvas style={{ width: width + PAD * 2, height: height + (PAD + room) * 2 }}>
          <Group transform={[{ translateX: PAD }, { translateY: PAD + room }]}>
            {stackShadow && <Image image={stackShadow.image} {...stackShadow.rect} fit="fill" />}
            {/* Read sheets, tucked under the stack: only their edges show. */}
            {ready.map((faces, i) => (
              <ReadSheet key={`under${i}`} layer="under" faces={faces} shadow={liftedShadow} index={i} mark={marks[i]} turn={turn} grip={grip} seed={look.seed} edge={edge} width={width} height={height} />
            ))}
            {/* The stack, the first unread sheet on top. */}
            {ready
              .map((faces, i) => (
                <ReadSheet key={`top${i}`} layer="top" faces={faces} shadow={liftedShadow} index={i} mark={marks[i]} turn={turn} grip={grip} seed={look.seed} edge={edge} width={width} height={height} />
              ))
              .reverse()}
          </Group>
        </Canvas>
      </GestureDetector>
    </Animated.View>
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
  shadow,
  index,
  mark,
  turn,
  grip,
  seed,
  edge,
  width,
  height,
}: {
  layer: 'top' | 'under';
  faces: SheetFaces;
  shadow: ReturnType<typeof useShadow>;
  index: number;
  mark: { first: number; hasBack: boolean; done: number };
  turn: SharedValue<number>;
  grip: SharedValue<Grip>;
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
    const { tilt, ux, uy } = grip.value;
    // Out the way it was pushed (mostly sideways: the reading view is short), just clear
    // of the stack at 0.5, then back in underneath.
    const away = Math.sin(Math.PI * ease(out.value));
    const len = Math.hypot(ux, uy * 0.35) || 1;
    const sx = ux / len;
    const sy = (uy * 0.35) / len;
    const clear = Math.min(
      Math.abs(sx) > 0.01 ? (width * 1.04) / Math.abs(sx) : Infinity,
      Math.abs(sy) > 0.01 ? (height * 1.04) / Math.abs(sy) : Infinity,
    );
    // Turned over about an axis leaning by `tilt`, travelling a little with the hand; the twist
    // (tilt − 2·tilt·e) lands the back as the plain mirror versoThrough is drawn for, at any lean.
    const e = angle.value / Math.PI;
    const twist = tilt - 2 * tilt * e * e * (3 - 2 * e);
    const lift = Math.sin(angle.value) * width * 0.05;
    return [
      { translateX: j.dx + sx * clear * away + ux * lift },
      { translateY: j.dy + sy * clear * away + uy * lift - height * 0.025 * away },
      { rotate: j.rot * 0.4 + 0.05 * sx * away },
      { perspective: PERSPECTIVE },
      { rotate: twist },
      { rotateY: -angle.value },
      { rotate: -tilt },
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
        {layer === 'top' && shadow && <Image image={shadow.image} {...shadow.rect} fit="fill" opacity={lifted} />}
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
