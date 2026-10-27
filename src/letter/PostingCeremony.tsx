import { Canvas, Group, LinearGradient, Picture, Rect, Skia, vec, type Transforms3d } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import {
  Easing,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { feel } from '../lib/haptics';
import type { Country, PostboxSkin } from '../theme/stationery';
import { ENVELOPE_MM, envelopeGeometry, recordBulge, recordEnvelope, restingPacket } from './envelope';
import type { EnvelopeLook } from './EnvelopeCeremony';
import { postboxLayout, recordPostbox } from './steelBox';
import { useTypefaces } from './useTypefaces';
import { WaxSeal } from './WaxSeal';

/**
 * Posting: one progress value p ∈ [0, 1].
 *   0.00–0.15  orient: the envelope tilts out of the wall; at a RU box it also turns
 *              to portrait (a DL envelope only fits the 171 mm slot short edge first),
 *              at a FR box it goes in long edge first
 *   0.15–0.85  insert: it slides through the slot; the part inside is clipped and
 *              darkens near the lip; the wax seal catches on the lip for a moment
 *   0.85–1.00  drop: it falls in, the inner flap swings shut
 * Commit when released past 0.55 or flicked up; otherwise it springs back out.
 */

const PERSPECTIVE = 900;
// Positive: the bottom of the envelope comes out of the wall, towards the viewer.
const TILT = 1.15;
const SNAG_RAW = 30; // finger travel spent pushing the seal through the lip...
const SNAG_GAIN = 12; // ...for this much envelope travel

function clamp01(x: number) {
  'worklet';
  return Math.min(1, Math.max(0, x));
}
function ease(x: number) {
  'worklet';
  const c = clamp01(x);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

type Props = {
  width: number;
  height: number;
  look: EnvelopeLook;
  skin: PostboxSkin;
  /** The sender's post office: RU wall box (short edge first) or FR street box (long edge first). */
  country?: Country;
  /** Shown handwritten on the collection sticker, e.g. "14:37". */
  collectAt: string;
  fixedT?: number;
  onPosted?: () => void;
  onRetrieved?: () => void;
  /** Bump to post without the gesture (accessibility, Reduce Motion). */
  commitKey?: number;
  /** Bump to take the letter back out (grace window). */
  retrieveKey?: number;
  /** How much the letter inside rounds the envelope out (bulgeFor), 0..1. */
  bulge?: number;
};

export function PostingCeremony({
  width,
  height,
  look,
  skin,
  country = 'ru',
  collectAt,
  fixedT,
  onPosted,
  onRetrieved,
  commitKey,
  retrieveKey,
  bulge = 0,
}: Props) {
  const format = look.format ?? 'DL';
  const layout = useMemo(() => postboxLayout(width, height, country, ENVELOPE_MM[format].w), [width, height, country, format]);
  const s = layout.scale;
  const faces = useTypefaces();
  const box = useMemo(
    () =>
      faces &&
      recordPostbox(layout, skin, collectAt, { print: faces.print, printBold: faces.printBold, marker: faces.marker }, look.seed),
    [faces, layout, skin, collectAt, look.seed],
  );
  const g = useMemo(() => envelopeGeometry(Math.round(ENVELOPE_MM[format].w * s), look.seed, format), [s, look.seed, format]);
  const parts = useMemo(() => recordEnvelope(g, look.paper, look.liner, look.seed), [g, look.paper, look.liner, look.seed]);
  const bulgePic = useMemo(() => recordBulge(g, restingPacket(g), bulge), [g, bulge]);

  const pw = g.width;
  const ph = g.height;
  const { slot } = layout;
  // Short edge first (RU): the envelope turns a quarter and its left edge leads.
  // Long edge first (FR): no turn, the top edge (flap side) leads.
  const turn = layout.shortEdgeFirst;
  const across = turn ? ph : pw; // envelope width across the slot
  const length = turn ? pw : ph; // how far it travels into the slot
  const rest = turn ? { x: width / 2 - pw / 2, y: height * 0.74 } : { x: width / 2, y: height * 0.74 - ph / 2 };
  const hinge = { x: width / 2, y: slot.y + slot.h / 2 };
  // The seal's leading edge reaches the lip at this much insertion (portrait: picture x → depth).
  const snagAt = (turn ? g.seal.x : g.seal.y) - g.seal.maxR;
  const fingerTravel = (140 + length + SNAG_RAW - SNAG_GAIN) / 0.85;

  const p = useSharedValue(fixedT ?? 0);
  const start = useSharedValue(0);
  const settled = useSharedValue(false);
  const done = useSharedValue(false);

  useEffect(() => {
    if (fixedT !== undefined) p.set(fixedT);
  }, [fixedT, p]);

  const commit = (velocity: number) => {
    'worklet';
    done.set(true);
    p.set(
      withSpring(1, { velocity: Math.max(velocity, 0.6), overshootClamping: true, stiffness: 900, damping: 60 }, (finished) => {
        if (finished && onPosted) scheduleOnRN(onPosted);
      }),
    );
  };
  const back = (velocity: number) => {
    'worklet';
    p.set(withSpring(0, { velocity, damping: 16, stiffness: 320, overshootClamping: true }));
  };

  // Only presses made while mounted count.
  const keysAtMount = useRef({ commitKey, retrieveKey });
  useEffect(() => {
    if (commitKey && commitKey !== keysAtMount.current.commitKey) commit(0.8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitKey]);
  useEffect(() => {
    if (!retrieveKey || retrieveKey === keysAtMount.current.retrieveKey) return;
    done.set(false);
    p.set(
      withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished && onRetrieved) scheduleOnRN(onRetrieved);
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retrieveKey]);

  const pan = usePanGesture({
    enabled: fixedT === undefined,
    onBegin: () => {
      start.set(p.get());
      settled.set(false);
    },
    onUpdate: (e) => {
      if (done.get()) return;
      p.set(Math.min(0.85, Math.max(0, start.get() - e.translationY / fingerTravel)));
    },
    onDeactivate: (e) => {
      if (done.get()) return;
      settled.set(true);
      const v = -e.velocityY / fingerTravel;
      const now = p.get();
      // A system-cancelled gesture (call, scroll) must never post the letter.
      if (!e.canceled && (now >= 0.55 || (e.velocityY <= -900 && now >= 0.15))) commit(v);
      else back(v);
    },
    onFinalize: () => {
      if (done.get() || settled.get()) return;
      if (p.get() > 0) back(0);
    },
  });

  // ── pose ──
  const orient = useDerivedValue(() => ease(p.get() / 0.15));
  const insertK = useDerivedValue(() => clamp01((p.get() - 0.15) / 0.7));
  const depth = useDerivedValue(() => {
    // Envelope travel into the slot, with the seal catching on the lip.
    const raw = insertK.get() * (length + SNAG_RAW - SNAG_GAIN);
    if (raw < snagAt) return raw;
    if (raw < snagAt + SNAG_RAW) return snagAt + ((raw - snagAt) * SNAG_GAIN) / SNAG_RAW;
    return raw - SNAG_RAW + SNAG_GAIN;
  });

  const hingeTransform = useDerivedValue<Transforms3d>(() => {
    const o = orient.get();
    return [
      { translateX: rest.x + (hinge.x - rest.x) * o },
      { translateY: rest.y + (hinge.y - rest.y) * o },
      { perspective: PERSPECTIVE },
      { rotateX: TILT * o },
      { translateY: -depth.get() },
    ];
  });
  const envelopeTransform = useDerivedValue(() =>
    turn ? [{ rotate: (Math.PI / 2) * orient.get() }, { translateY: -ph / 2 }] : [{ translateX: -pw / 2 }],
  );
  // Before contact nothing is clipped; after, everything beyond the slot plane is inside the box.
  const visible = useDerivedValue(() =>
    p.get() < 0.15 ? Skia.XYWHRect(-4000, -4000, 8000, 8000) : Skia.XYWHRect(-across, depth.get(), across * 2, length * 2),
  );
  const nearSlot = useDerivedValue(() => (p.get() > 0.15 ? 1 : 0));
  const darkRect = useDerivedValue(() => Skia.XYWHRect(-across / 2 - 2, depth.get(), across + 4, 34 * (s / 1.6)));
  const darkStart = useDerivedValue(() => vec(0, depth.get()));
  const darkEnd = useDerivedValue(() => vec(0, depth.get() + 34 * (s / 1.6)));

  // Inner flap: pushed open by the envelope, swings back with a little bounce after the drop.
  const flapOpen = useDerivedValue(() => {
    const t = p.get();
    if (t < 0.15) return 0;
    if (t < 0.85) return Math.min(insertK.get() * 9, 1);
    const k = (t - 0.85) / 0.15;
    return Math.max(0, Math.cos(k * Math.PI * 1.5) * (1 - k));
  });
  const flapShade = useDerivedValue(() => 0.85 - 0.75 * flapOpen.get());
  // The tilted envelope shades the box face just below the slot.
  const faceShadow = useDerivedValue(() => (p.get() > 0.15 && p.get() < 0.85 ? 0.5 * orient.get() : 0));

  useAnimatedReaction(
    () => [p.get() > 0.15, depth.get() > snagAt, p.get() > 0.86, p.get() > 0.97] as const,
    (now, prev) => {
      if (!prev) return;
      if (now[0] && !prev[0]) scheduleOnRN(feel.tick);
      if (now[1] && !prev[1]) scheduleOnRN(feel.tick);
      if (now[2] && !prev[2]) scheduleOnRN(feel.posted);
      if (now[3] && !prev[3]) scheduleOnRN(feel.clack);
    },
  );

  if (!box) return <View style={{ width, height }} />;
  return (
    <GestureDetector gesture={pan}>
      <Canvas style={{ width, height }}>
        <Picture picture={box} />
        {/* the inner flap, seen through the slot */}
        <Rect x={slot.x + slot.h / 2} y={slot.y + 1} width={slot.w - slot.h} height={slot.h - 2} color="#4a4c55" opacity={flapShade} />
        <Rect x={width / 2 - across / 2} y={slot.y + slot.h} width={across} height={40 * (s / 1.6)} opacity={faceShadow}>
          <LinearGradient start={vec(0, slot.y + slot.h)} end={vec(0, slot.y + slot.h + 40 * (s / 1.6))} colors={['rgba(10,10,20,0.55)', 'rgba(10,10,20,0)']} />
        </Rect>

        <Group transform={hingeTransform}>
          <Group clip={visible}>
            <Group transform={envelopeTransform}>
              <Picture picture={parts.pocket} />
              <Picture picture={parts.flapOuter} />
              {bulge > 0 && <Picture picture={bulgePic} />}
              <WaxSeal seal={g.seal} wax={look.wax} initials={look.initials} seed={look.seed} pour={1} imprint={1} />
            </Group>
            {/* light falls off into the slot: a hole, not a mask */}
            <Rect rect={darkRect} opacity={nearSlot}>
              <LinearGradient start={darkStart} end={darkEnd} colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0)']} />
            </Rect>
          </Group>
        </Group>
      </Canvas>
    </GestureDetector>
  );
}
