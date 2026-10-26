import {
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Path,
  Picture,
  RadialGradient,
  Rect,
  Skia,
  vec,
  type SkPicture,
  type Transforms3d,
} from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { useAnimatedReaction, useDerivedValue, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { feel } from '../lib/haptics';
import { mulberry32, subSeed, wobble } from '../lib/random';
import { envelopeGeometry, recordEnvelope, recordFoldedLetter } from './envelope';
import type { EnvelopeLook } from './EnvelopeCeremony';
import { recordEnvelopeFront, type Address, type Postmark } from './envelopeFront';
import { mailboxLayout, recordDoor, recordMailboxBank } from './steelBox';
import { slitCatches, slitEdge } from './tear';
import { useTypefaces } from './useTypefaces';
import { WaxSeal } from './WaxSeal';

/**
 * Receiving, five stages with one progress value each:
 *   0 door   tap to unlock and swing it open, or drag it open (hinge on the left)
 *   1 take   pull the envelope up and out of the box (or tap)
 *   2 flip   tap to turn it over: address side → seal side
 *   3 slit   run the paper knife along the top fold from either corner
 *   4 pull   draw the folded letter up out of the slit
 * Unfolding is FoldableLetter, started folded. Re-reading skips all of this.
 */

export type ReceiveStage = 0 | 1 | 2 | 3 | 4 | 5;

const DOOR_MAX = (105 * Math.PI) / 180;

function clamp01(x: number) {
  'worklet';
  return Math.min(1, Math.max(0, x));
}
function ease(x: number) {
  'worklet';
  const c = clamp01(x);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}
const lerp = (a: number, b: number, t: number) => {
  'worklet';
  return a + (b - a) * t;
};

/** One QA timeline (0..0.7) mapped onto the five stage progresses. */
export function splitReceiveT(t: number) {
  const seg = (a: number, b: number) => clamp01((t - a) / (b - a));
  const values = [seg(0, 0.1), seg(0.1, 0.25), seg(0.25, 0.32), seg(0.32, 0.5), seg(0.5, 0.7)];
  const stage = values.findIndex((v) => v < 1);
  return { values, stage: (stage === -1 ? 5 : stage) as ReceiveStage };
}

type Props = {
  width: number;
  height: number;
  look: EnvelopeLook;
  address: Address;
  postmark: Postmark;
  letterFront: SkPicture;
  letterBack: SkPicture;
  sheet: { width: number; height: number };
  flat: number;
  fixedT?: number;
  onStage?: (s: ReceiveStage) => void;
  /** Bump to advance the current stage without a gesture (accessibility). */
  advanceKey?: number;
};

export function ReceivingCeremony({ width, height, look, address, postmark, letterFront, letterBack, sheet, flat, fixedT, onStage, advanceKey }: Props) {
  const faces = useTypefaces();
  const L = useMemo(() => mailboxLayout(width, height), [width, height]);
  const { door } = L;
  const bank = useMemo(() => faces && recordMailboxBank(L, flat - 4, look.seed, faces.print), [faces, L, flat, look.seed]);
  const doorPics = useMemo(() => faces && recordDoor(L, flat, look.seed + 3, faces.print), [faces, L, flat, look.seed]);

  // The envelope, at the size it is read at.
  const ew = Math.round(Math.min(width - 40, 360));
  const g = useMemo(() => envelopeGeometry(ew, look.seed), [ew, look.seed]);
  const eh = g.height;
  const parts = useMemo(() => recordEnvelope(g, look.paper, look.liner, look.seed), [g, look.paper, look.liner, look.seed]);
  const front = useMemo(
    () => faces && recordEnvelopeFront(g, look.paper, look.seed, address, postmark, faces, { wear: true }),
    [faces, g, look.paper, look.seed, address, postmark],
  );
  const letter = useMemo(() => recordFoldedLetter(letterFront, letterBack, sheet, look.seed), [letterFront, letterBack, sheet, look.seed]);
  const edge = useMemo(() => {
    const pts = slitEdge(ew, look.seed);
    const b = Skia.PathBuilder.Make().moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) b.lineTo(pts[i], pts[i + 1]);
    return b.detach();
  }, [ew, look.seed]);
  const catches = useMemo(() => slitCatches(ew, look.seed), [ew, look.seed]);

  // Poses: lying on the floor of the box → held in front of you.
  const rand = mulberry32(subSeed(look.seed, 'mailbox'));
  const inside = { x: door.x + door.w * 0.5, y: door.y + door.h * 0.7, scale: (door.w * 0.86) / ew, tilt: 1.05, rot: 0.12 + wobble(rand, 0.05) };
  const held = { x: width / 2, y: height * 0.6, scale: 1, tilt: 0, rot: wobble(rand, 0.02) };

  // ── state ──
  const init = splitReceiveT(fixedT ?? 0);
  const doorV = useSharedValue(init.values[0]);
  const take = useSharedValue(init.values[1]);
  const flip = useSharedValue(init.values[2]);
  const slit = useSharedValue(init.values[3]);
  const pull = useSharedValue(init.values[4]);
  const progress = [doorV, take, flip, slit, pull];
  const stage = useSharedValue<ReceiveStage>(init.stage);
  const gStage = useSharedValue<ReceiveStage>(0);
  const start = useSharedValue(0);
  const settled = useSharedValue(false);
  const slitDir = useSharedValue(1); // 1: left → right, -1: right → left

  useEffect(() => {
    if (fixedT === undefined) return;
    const v = splitReceiveT(fixedT);
    v.values.forEach((x, i) => progress[i].set(x));
    stage.set(v.stage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedT]);

  const finish = (i: number, velocity = 0) => {
    'worklet';
    progress[i].set(withSpring(1, { velocity, damping: 20, stiffness: 150, overshootClamping: true }));
  };
  const back = (i: number, velocity = 0) => {
    'worklet';
    progress[i].set(withSpring(0, { velocity, damping: 20, stiffness: 170, overshootClamping: true }));
  };

  useEffect(() => {
    if (!advanceKey) return;
    const s = stage.get();
    if (s < 5) finish(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advanceKey]);

  const envelopeLeft = held.x - ew / 2;
  const pan = usePanGesture({
    enabled: fixedT === undefined,
    minDistance: 0,
    onBegin: (e) => {
      const s = stage.get();
      gStage.set(s);
      settled.set(false);
      if (s < 5) start.set(progress[s].get());
      if (s === 3 && slit.get() === 0) slitDir.set(e.x < width / 2 ? 1 : -1);
    },
    onUpdate: (e) => {
      const s = gStage.get();
      if (s === 0) doorV.set(clamp01(start.get() + e.translationX / (door.w * 1.1)));
      if (s === 1) take.set(clamp01(start.get() - e.translationY / (height * 0.45)));
      if (s === 3) {
        // The knife front follows the finger along the fold, from the corner it started at.
        const x = slitDir.get() === 1 ? e.x - envelopeLeft : envelopeLeft + ew - e.x;
        slit.set(Math.max(start.get(), clamp01(x / ew)));
      }
      if (s === 4) pull.set(clamp01(start.get() - e.translationY / (letter.height * 1.3)));
    },
    onDeactivate: (e) => {
      const s = gStage.get();
      settled.set(true);
      if (e.canceled) {
        if (s === 0 || s === 1 || s === 4) back(s);
        return;
      }
      // With minDistance 0 a tap activates too (native), or never activates (web: see onFinalize).
      if (s <= 2 && Math.hypot(e.translationX, e.translationY) < 6) {
        finish(s);
        return;
      }
      if (s === 0) {
        const v = e.velocityX / (door.w * 1.1);
        if (doorV.get() > 0.35 || v > 0.6) finish(0, v);
        else back(0, v);
      }
      if (s === 1) {
        const v = -e.velocityY / (height * 0.45);
        if (take.get() > 0.5 || v > 0.8) finish(1, v);
        else back(1, v);
      }
      // A slit stays where you left it; near the end the knife runs out on its own.
      if (s === 3 && slit.get() > 0.92) finish(3);
      if (s === 4) {
        const v = -e.velocityY / (letter.height * 1.3);
        if (pull.get() > 0.82 || v > 0.9) finish(4, v);
        else back(4, v);
      }
    },
    onFinalize: () => {
      // Taps (no movement) never activate the pan: unlock-and-open, take, flip.
      if (settled.get()) return;
      const s = gStage.get();
      if (s === 0 || s === 1 || s === 2) finish(s);
    },
  });

  // Stage advance + haptics.
  useAnimatedReaction(
    () => progress.map((v) => v.get() >= 0.97),
    (now, prev) => {
      if (fixedT !== undefined) return;
      const s = stage.get();
      if (s < 5 && now[s] && !(prev && prev[s])) {
        stage.set((s + 1) as ReceiveStage);
        scheduleOnRN([feel.door, feel.crease, feel.tick, feel.tick, feel.crease][s]);
      }
    },
  );
  useAnimatedReaction(
    () => stage.get(),
    (s, prev) => {
      if (s !== prev && onStage) scheduleOnRN(onStage, s);
    },
  );
  useAnimatedReaction(
    () => {
      const x = slit.get();
      let n = 0;
      for (const c of catches) if (x >= c) n++;
      return n;
    },
    (n, prev) => {
      if (prev !== null && n > prev) scheduleOnRN(feel.fibre);
    },
  );

  // ── door ──
  const doorAngle = useDerivedValue(() => ease(doorV.get()) * DOOR_MAX);
  const doorTransform = useDerivedValue<Transforms3d>(() => [{ perspective: 800 }, { rotateY: -doorAngle.get() }]);
  const doorRect = Skia.XYWHRect(door.x, door.y, door.w, door.h);
  const EMPTY = Skia.XYWHRect(0, 0, 0, 0);
  const outsideFace = useDerivedValue(() => (doorAngle.get() < Math.PI / 2 ? doorRect : EMPTY));
  const insideFace = useDerivedValue(() => (doorAngle.get() < Math.PI / 2 ? EMPTY : doorRect));
  const doorShade = useDerivedValue(() => 0.35 * Math.sin(doorAngle.get()));
  // Light reaching the inside of the box as the door opens.
  const darkness = useDerivedValue(() => 1 - (0.12 + 0.53 * Math.sin(Math.min(doorAngle.get(), Math.PI / 2))));

  // ── envelope pose ──
  const lift = useDerivedValue(() => ease(take.get()));
  const poseTransform = useDerivedValue<Transforms3d>(() => {
    const k = lift.get();
    return [
      { translateX: lerp(inside.x, held.x, k) },
      { translateY: lerp(inside.y, held.y, k) - Math.sin(k * Math.PI) * 30 },
      { perspective: 700 },
      { rotateX: lerp(inside.tilt, held.tilt, k) },
      { rotate: lerp(inside.rot, held.rot, k) },
      { scale: lerp(inside.scale, held.scale, k) },
      { translateX: -ew / 2 },
      { translateY: -eh / 2 },
    ];
  });
  // Still inside the box: clipped by its opening and in its shadow. Out: on top of everything.
  const BIG = Skia.XYWHRect(-4000, -4000, 8000, 8000);
  const inBoxClip = useDerivedValue(() => (take.get() < 0.4 ? doorRect : EMPTY));
  const outClip = useDerivedValue(() => (take.get() < 0.4 ? EMPTY : BIG));
  const scrim = useDerivedValue(() => 0.55 * lift.get());

  // ── flip ──
  const flipAngle = useDerivedValue(() => ease(flip.get()) * Math.PI);
  const flipTransform = useDerivedValue<Transforms3d>(() => [{ perspective: 1000 }, { rotateY: flipAngle.get() }]);
  const envRect = Skia.XYWHRect(0, 0, ew, eh);
  const frontClip = useDerivedValue(() => (flipAngle.get() < Math.PI / 2 ? envRect : EMPTY));
  const backClip = useDerivedValue(() => (flipAngle.get() < Math.PI / 2 ? EMPTY : envRect));
  const flipShade = useDerivedValue(() => 0.3 * Math.sin(flipAngle.get()));

  // ── slit ──
  const cutClip = useDerivedValue(() => {
    const x = slit.get() * ew;
    return slitDir.get() === 1 ? Skia.XYWHRect(0, -2, x, 8) : Skia.XYWHRect(ew - x, -2, x, 8);
  });
  const knifeShown = useDerivedValue(() => (stage.get() === 3 && slit.get() < 1 ? 1 : 0));
  const knifeTransform = useDerivedValue(() => {
    const x = slitDir.get() === 1 ? slit.get() * ew : ew - slit.get() * ew;
    return [{ translateX: x }, { translateY: 1.5 }, { scaleX: slitDir.get() }];
  });
  const gap = useDerivedValue(() => (slit.get() >= 1 ? 1 : 0));

  // ── pull ──
  const lw = ew * 0.93;
  const letterScale = lw / letter.width;
  const letterTilt = wobble(rand, 0.012);
  const letterTransform = useDerivedValue(() => {
    const k = pull.get();
    const y0 = eh - letter.height * letterScale - 4;
    const y1 = -letter.height * letterScale - 14;
    return [{ translateX: (ew - lw) / 2 }, { translateY: lerp(y0, y1, k) }, { rotate: letterTilt * k }, { scale: letterScale }];
  });
  // Pictures ignore group opacity: hide the letter with a clip until the envelope is open.
  const letterClip = useDerivedValue(() => (flip.get() >= 1 && slit.get() >= 1 ? BIG : EMPTY));

  if (!bank || !doorPics || !front) return <View style={{ width, height }} />;

  const knife = Skia.PathBuilder.Make()
    .moveTo(0, 0)
    .lineTo(-70, -26)
    .lineTo(-72, -19)
    .close()
    .detach();
  const handle = Skia.RRectXY(Skia.XYWHRect(-118, -38, 50, 14), 5, 5);

  return (
    <GestureDetector gesture={pan}>
      <Canvas style={{ width, height }}>
        <Picture picture={bank} />

        {/* inside our box: back wall, then the envelope lying on the floor, then the shadow of the box */}
        <Group clip={doorRect}>
          <Rect rect={doorRect}>
            <LinearGradient start={vec(0, door.y)} end={vec(0, door.y + door.h)} colors={['#1d1a17', '#3a342e']} />
          </Rect>
          <Group clip={inBoxClip}>
            <Group transform={poseTransform}>
              <Picture picture={front} />
            </Group>
          </Group>
          <Rect rect={doorRect} color="#000" opacity={darkness} />
        </Group>

        {/* our door, hinged on its left edge */}
        {/* perspective must share the rotation's transform list: each Group flattens to 2D */}
        <Group>
          <Group origin={{ x: door.x, y: door.y + door.h / 2 }} transform={doorTransform}>
            <Group clip={outsideFace}>
              <Picture picture={doorPics.outside} />
              {/* the envelope shows pale through the peek holes */}
              {L.holes.slice(1, 5).map((h, i) => (
                <Circle key={i} cx={h.x} cy={h.y} r={h.r * 0.8}>
                  <RadialGradient c={vec(h.x - h.r * 0.3, h.y - h.r * 0.3)} r={h.r * 1.3} colors={['#d9d1bf', '#8f8775']} />
                </Circle>
              ))}
              <Rect rect={doorRect} color="#000" opacity={doorShade} />
            </Group>
            <Group clip={insideFace}>
              <Picture picture={doorPics.inside} />
            </Group>
          </Group>
        </Group>

        <Rect x={0} y={0} width={width} height={height} color="#120c08" opacity={scrim} />

        {/* the envelope out of the box, in your hands */}
        <Group clip={outClip}>
          <Group transform={poseTransform}>
            <Group clip={letterClip}>
              <Group transform={letterTransform}>
                <Picture picture={letter.picture} />
              </Group>
            </Group>
            <Group origin={{ x: ew / 2, y: eh / 2 }} transform={flipTransform}>
              <Group clip={frontClip}>
                <Picture picture={front} />
                <Rect rect={envRect} color="#140c04" opacity={flipShade} />
              </Group>
              <Group clip={backClip}>
                {/* the back face is pre-mirrored so it reads correctly after a half turn */}
                <Group transform={[{ translateX: ew }, { scaleX: -1 }]}>
                  <Picture picture={parts.pocket} />
                  <Picture picture={parts.flapOuter} />
                  <WaxSeal seal={g.seal} wax={look.wax} initials={look.initials} seed={look.seed} pour={1} imprint={1} cracked />
                  <Rect rect={envRect} opacity={0.6}>
                    <RadialGradient c={vec(ew / 2, eh / 2)} r={ew * 0.62} colors={['rgba(60,40,20,0)', 'rgba(60,40,20,0.08)']} />
                  </Rect>
                  <Rect rect={envRect} color="#140c04" opacity={flipShade} />
                </Group>
              </Group>
            </Group>
            {/* after a full flip, back-face coordinates are plain envelope coordinates */}
            {/* the slit: a dark cut with the paper's light core under it */}
            <Group clip={cutClip}>
              <Path path={edge} style="stroke" strokeWidth={1.1} color="rgba(25, 15, 8, 0.8)" />
              <Path path={edge} style="stroke" strokeWidth={0.8} color="rgba(255, 252, 240, 0.85)" transform={[{ translateY: 1 }]} />
              <Rect x={0} y={-1} width={ew} height={2.2} color="rgba(10, 6, 4, 0.55)" opacity={gap} />
            </Group>
            {/* paper knife */}
            <Group transform={knifeTransform} opacity={knifeShown}>
              <Path path={knife}>
                <LinearGradient start={vec(0, 0)} end={vec(-70, -26)} colors={['#e9d6a2', '#b08d57', '#7d6034']} />
              </Path>
              <Group transform={[{ rotate: 0.36 }]}>
                <Rect rect={handle.rect} color="#5a3a22" />
              </Group>
            </Group>
          </Group>
        </Group>
      </Canvas>
    </GestureDetector>
  );
}
