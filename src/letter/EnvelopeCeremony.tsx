import {
  BlurMask,
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Picture,
  RadialGradient,
  Rect,
  Shadow,
  Skia,
  vec,
  type SkPicture,
  type Transforms3d,
} from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import {
  Easing,
  cancelAnimation,
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
import { mulberry32, subSeed, wobble } from '../lib/random';
import type { LinerKind, PaperKind, WaxKind, WaxType } from '../theme/stationery';
import { envelopeGeometry, recordEnvelope, recordFoldedLetter } from './envelope';
import { WaxSeal } from './WaxSeal';

/**
 * Sealing ceremony, four stages, each driven by its own progress value:
 *   0 insert  drag the folded letter down into the pocket
 *   1 close   drag the flap down (or tap) — it swings over in perspective
 *   2 pour    hold to pour wax; the puddle grows while you hold
 *   3 press   release: the brass seal drops, imprints the monogram, lifts away
 *   4 sealed
 */

export type Stage = 0 | 1 | 2 | 3 | 4;

export type EnvelopeLook = {
  paper: PaperKind;
  liner: LinerKind;
  wax: WaxKind;
  /** Brittle by default. */
  waxType?: WaxType;
  initials: string;
  seed: number;
};

type Props = {
  letterFront: SkPicture;
  letterBack: SkPicture;
  sheet: { width: number; height: number };
  width: number;
  look: EnvelopeLook;
  onStage?: (stage: Stage) => void;
  /** Freeze the whole ceremony at t ∈ [0, 1] (visual QA). */
  fixedT?: number;
  /** Bump to start over. */
  resetKey?: number;
};

const PERSPECTIVE = 1100;
const FLAP_OPEN = Math.PI * 0.985;
const PAD = 24;

function clamp01(x: number) {
  'worklet';
  return Math.min(1, Math.max(0, x));
}
function easeInOut(x: number) {
  'worklet';
  const c = clamp01(x);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/** Maps a single QA timeline onto the four stage progresses. */
function splitT(t: number) {
  return {
    insert: clamp01(t / 0.3),
    close: clamp01((t - 0.3) / 0.2),
    pour: clamp01((t - 0.5) / 0.2),
    press: clamp01((t - 0.7) / 0.3),
    stage: (t < 0.3 ? 0 : t < 0.5 ? 1 : t < 0.7 ? 2 : t < 1 ? 3 : 4) as Stage,
  };
}

export function EnvelopeCeremony({ letterFront, letterBack, sheet, width, look, onStage, fixedT, resetKey }: Props) {
  const g = useMemo(() => envelopeGeometry(width, look.seed), [width, look.seed]);
  const parts = useMemo(() => recordEnvelope(g, look.paper, look.liner, look.seed), [g, look.paper, look.liner, look.seed]);
  const letter = useMemo(() => recordFoldedLetter(letterFront, letterBack, sheet, look.seed), [letterFront, letterBack, sheet, look.seed]);


  // Letter placement: seeded crookedness, resting on the bottom of the pocket.
  const rand = mulberry32(subSeed(look.seed, 'insert'));
  const letterX = (g.width - letter.width) / 2 + wobble(rand, 2.5);
  const restRot = wobble(rand, 0.012);
  const startRot = restRot - 0.05 * (rand() > 0.5 ? 1 : -1);
  const yStart = -letter.height - 8;
  const yEnd = g.height - letter.height - g.height * 0.045;
  const top = Math.ceil(letter.height + g.flapTip * 0.2 + PAD);
  const canvasH = top + g.height + PAD * 2;

  const insert = useSharedValue(0);
  const close = useSharedValue(0);
  const pour = useSharedValue(0);
  const press = useSharedValue(0);
  const stage = useSharedValue<Stage>(0);
  const start = useSharedValue(0);
  // A gesture belongs to the stage it started in, even if that stage completes mid-drag.
  const gestureStage = useSharedValue<Stage>(0);
  const gestureStartY = useSharedValue(0);
  const settled = useSharedValue(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const v = fixedT === undefined ? splitT(0) : splitT(fixedT);
    insert.set(v.insert);
    close.set(v.close);
    pour.set(v.pour);
    press.set(v.press);
    stage.set(v.stage);
    onStage?.(v.stage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedT, resetKey]);

  const settle = (target: number, velocity: number) => {
    'worklet';
    return reduceMotion
      ? withTiming(target, { duration: 200, easing: Easing.out(Easing.quad) })
      : withSpring(target, { velocity, damping: 20, stiffness: 150, mass: 0.9, overshootClamping: true });
  };

  const insertTravel = yEnd - yStart;
  const pan = usePanGesture({
    enabled: fixedT === undefined,
    minDistance: 0,
    onBegin: (e) => {
      const s = stage.get();
      gestureStage.set(s);
      gestureStartY.set(e.y);
      settled.set(false);
      if (s === 0) start.set(insert.get());
      if (s === 1) start.set(close.get());
      if (s === 2) {
        // Wax flows while the finger is down; the puddle keeps what was poured.
        pour.set(withTiming(1, { duration: 2200 * (1 - pour.get()), easing: Easing.linear }));
      }
    },
    onUpdate: (e) => {
      const s = gestureStage.get();
      if (s === 0) insert.set(clamp01(start.get() + e.translationY / insertTravel));
      if (s === 1) close.set(clamp01(start.get() + e.translationY / (g.flapTip * 1.6)));
    },
    onDeactivate: (e) => {
      const s = gestureStage.get();
      settled.set(true);
      if (s === 0) {
        const v = e.velocityY / insertTravel;
        insert.set(settle(v > 0.5 || insert.get() > 0.55 ? 1 : 0, v));
      }
      if (s === 1) {
        const tap = Math.abs(e.translationY) < 6;
        const v = e.velocityY / (g.flapTip * 1.6);
        close.set(settle(tap || v > 0.5 || close.get() > 0.45 ? 1 : 0, v));
      }
    },
    onFinalize: (e) => {
      // A tap never activates the pan (no movement), so it only shows up here.
      if (gestureStage.get() === 1 && !settled.get() && Math.abs(e.y - gestureStartY.get()) < 6) {
        close.set(settle(1, 0));
        return;
      }
      if (gestureStage.get() !== 2) return;
      cancelAnimation(pour);
      if (pour.get() > 0.3) {
        stage.set(3);
        press.set(withTiming(1, { duration: reduceMotion ? 500 : 1500, easing: Easing.linear }));
      }
    },
  });

  // Stage transitions + haptics on forward crossings.
  useAnimatedReaction(
    () => [insert.get() > 0.995, close.get() > 0.995, press.get() >= 1] as const,
    ([inserted, closed, pressed], prev) => {
      if (fixedT !== undefined) return;
      if (inserted && !prev?.[0] && stage.get() === 0) {
        stage.set(1);
        scheduleOnRN(feel.crease);
      }
      if (closed && !prev?.[1] && stage.get() === 1) {
        stage.set(2);
        scheduleOnRN(feel.tick);
      }
      if (pressed && !prev?.[2] && stage.get() === 3) stage.set(4);
    },
  );
  useAnimatedReaction(
    () => stage.get(),
    (s, prev) => {
      if (s !== prev && onStage) scheduleOnRN(onStage, s);
    },
  );
  useAnimatedReaction(
    () => Math.floor(pour.get() / 0.2),
    (n, prev) => {
      if (prev !== null && n > prev && stage.get() === 2) scheduleOnRN(feel.tick);
    },
  );
  useAnimatedReaction(
    () => press.get() >= 0.4,
    (hit, prev) => {
      if (hit && prev === false) scheduleOnRN(feel.press);
    },
  );

  // ── letter ──
  const letterTransform = useDerivedValue(() => {
    const k = easeInOut(insert.get());
    return [
      { translateX: letterX },
      { translateY: yStart + (yEnd - yStart) * k },
      { rotate: startRot + (restRot - startRot) * k },
    ];
  });

  // ── flap ──
  const flapAngle = useDerivedValue(() => (1 - easeInOut(close.get())) * FLAP_OPEN);
  const flapTransform = useDerivedValue<Transforms3d>(() => [{ perspective: PERSPECTIVE }, { rotateX: -flapAngle.get() }]);
  const EMPTY = Skia.XYWHRect(0, 0, 0, 0);
  const flapBounds = Skia.XYWHRect(-2, -2, g.width + 4, g.flapTip + 8);
  const innerClip = useDerivedValue(() => (flapAngle.get() > Math.PI / 2 ? flapBounds : EMPTY));
  const outerClip = useDerivedValue(() => (flapAngle.get() > Math.PI / 2 ? EMPTY : flapBounds));
  const flapShade = useDerivedValue(() => 0.28 * Math.sin(flapAngle.get()));
  // The lifted flap throws a shadow over the pocket as it comes down.
  const flapCast = useDerivedValue(() => interpolate(flapAngle.get(), [0, 0.6, Math.PI / 2, FLAP_OPEN], [0, 0.16, 0.08, 0]));

  // ── wax ──
  const { seal } = g;
  const imprint = useDerivedValue(() => easeInOut((press.get() - 0.4) / 0.1));

  // ── brass seal ──
  const height = useDerivedValue(() => {
    const p = press.get();
    if (p < 0.4) return 1 - Math.pow(p / 0.4, 2); // falls: ease in
    if (p < 0.62) return 0;
    return easeInOut((p - 0.62) / 0.38);
  });
  const stampOpacity = useDerivedValue(() => {
    const p = press.get();
    return p <= 0 ? 0 : Math.min(1, p / 0.08) * (p < 0.62 ? 1 : 1 - easeInOut((p - 0.62) / 0.38));
  });
  const stampTransform = useDerivedValue(() => {
    const squash = press.get() > 0.4 && press.get() < 0.62 ? 0.985 : 1;
    const s = (1 + 0.55 * height.get()) * squash;
    return [{ translateX: seal.x }, { translateY: seal.y - 10 * height.get() }, { scale: s }];
  });
  const stampShadowTransform = useDerivedValue(() => [
    { translateX: seal.x + 2 + 14 * height.get() },
    { translateY: seal.y + 3 + 22 * height.get() },
  ]);
  const stampShadowBlur = useDerivedValue(() => 2 + 9 * height.get());
  const stampShadowOpacity = useDerivedValue(() => stampOpacity.get() * (0.5 - 0.25 * height.get()));
  const brassR = seal.stampR * 1.12;

  const envelopeTransform = [{ translateX: PAD }, { translateY: top }];

  return (
    <GestureDetector gesture={pan}>
      <Canvas style={{ width: g.width + PAD * 2, height: canvasH }}>
        <Group transform={envelopeTransform}>
          {/* envelope on the desk */}
          <Rect x={0} y={0} width={g.width} height={g.height} color="#000">
            <Shadow dx={2} dy={5} blur={9} color="rgba(20, 12, 4, 0.4)" shadowOnly />
          </Rect>

          {/* open flap, inner side: behind the letter */}
          <Group origin={{ x: g.width / 2, y: 0 }} transform={flapTransform}>
            <Group clip={innerClip}>
              <Picture picture={parts.flapInner} />
              <Group clip={g.flap}>
                <Rect x={0} y={0} width={g.width} height={g.flapTip} color="#140c04" opacity={flapShade} />
              </Group>
            </Group>
          </Group>

          <Picture picture={parts.interior} />

          <Group transform={letterTransform}>
            <Picture picture={letter.picture} />
          </Group>

          <Picture picture={parts.pocket} />
          <Group clip={g.flap}>
            <Rect x={0} y={0} width={g.width} height={g.height} color="#140c04" opacity={flapCast} />
          </Group>

          {/* closed flap, outer side: over everything */}
          <Group origin={{ x: g.width / 2, y: 0 }} transform={flapTransform}>
            <Group clip={outerClip}>
              <Picture picture={parts.flapOuter} />
              <Group clip={g.flap}>
                <Rect x={0} y={0} width={g.width} height={g.flapTip} color="#140c04" opacity={flapShade} />
              </Group>
            </Group>
          </Group>

          {/* sealing wax */}
          <WaxSeal seal={seal} wax={look.wax} initials={look.initials} seed={look.seed} pour={pour} imprint={imprint} />

          {/* brass seal, seen from above */}
          <Group transform={stampShadowTransform} opacity={stampShadowOpacity}>
            <Circle cx={0} cy={0} r={brassR} color="#1a0f06">
              <BlurMask blur={stampShadowBlur} style="normal" />
            </Circle>
          </Group>
          <Group transform={stampTransform} opacity={stampOpacity}>
            <Circle cx={0} cy={0} r={brassR}>
              <RadialGradient c={vec(-brassR * 0.35, -brassR * 0.4)} r={brassR * 1.5} colors={['#f1dc9c', '#c49a45', '#7a5a22', '#4d3714']} />
            </Circle>
            <Circle cx={0} cy={0} r={brassR - 1.5} style="stroke" strokeWidth={3} color="rgba(60, 40, 10, 0.55)">
              <DashPathEffect intervals={[1.6, 1.6]} />
            </Circle>
            <Circle cx={0} cy={0} r={brassR * 0.62}>
              <RadialGradient c={vec(-brassR * 0.2, -brassR * 0.25)} r={brassR * 0.75} colors={['#9a6a40', '#5e3a1f', '#2e1a0c']} />
            </Circle>
            <Circle cx={-brassR * 0.18} cy={-brassR * 0.2} r={brassR * 0.16} color="rgba(255, 235, 200, 0.22)">
              <BlurMask blur={3} style="normal" />
            </Circle>
          </Group>
        </Group>
      </Canvas>
    </GestureDetector>
  );
}
