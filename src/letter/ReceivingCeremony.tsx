import {
  BlurMask,
  Canvas,
  Text as SkiaText,
  Circle,
  DiscretePathEffect,
  Group,
  LinearGradient,
  Path,
  Picture,
  RadialGradient,
  Rect,
  Skia,
  vec,
  type SkPicture,
  type SkTypeface,
  type Transforms3d,
} from '@shopify/react-native-skia';
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
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { feel } from '../lib/haptics';
import { WAX, type Country, type PaperKind, type Rgb } from '../theme/stationery';
import { mulberry32, subSeed, wobble } from '../lib/random';
import { ENVELOPE_MM, envelopeGeometry, recordEnvelope, recordFoldedLetter, type EnvelopeFormat } from './envelope';
import type { FoldKind } from './fold';
import type { EnvelopeLook } from './EnvelopeCeremony';
import { recordEnvelopeFront, type Address, type Postmark } from './envelopeFront';
import { mailboxLayout, recordDoor, recordMailboxBank } from './steelBox';
import { coverSD, defaultSeal, edgeYAt, sealBounds, sealHold, sealToPx } from './seal';
import { breakGeometry, crumbAt, crumbLandsOn, crumbs as makeCrumbs, fibreTears, residueFibres, type Crumb } from './sealBreak';
import { slitCatches, slitEdge } from './tear';
import { useTypefaces } from './useTypefaces';
import { sealOutlinePath, WaxSeal } from './WaxSeal';

/**
 * Receiving, five stages with one progress value each:
 *   0 door   tap to unlock and swing it open, or drag it open (hinge on the left)
 *   1 take   pull the envelope up and out of the box (or tap)
 *   2 flip   tap to turn it over: address side → seal side
 *   3 open   either run the paper knife along the top fold from either corner,
 *            or pull the flap up by the seal: the wax strains, snaps along the flap
 *            edge (one half lifts with the flap, one stays), and the flap swings open.
 *            Only a seal across the flap's edge (sealHold 'straddle': at the tip or
 *            anywhere along the V) can be broken; one wholly on the flap or the body is
 *            decoration, stays whole, and the knife is the only way in
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
  /** RU: the flat number painted on the door. */
  flat: number;
  /** FR: the name on the nameplate. */
  name?: string;
  /** The recipient's mailbox: RU подъезд bank or FR batterie. */
  country?: Country;
  /** The sender's envelope: RU printed fields or FR address block. */
  senderCountry?: Country;
  /** Letters in the box, this one included (0: empty). Others lie underneath it. */
  waiting?: number;
  others?: { seed: number; paper: PaperKind; address: Address; postmark: Postmark; senderCountry?: Country; format?: EnvelopeFormat }[];
  /** Coming back for the next letter: the door is already open. */
  startOpen?: boolean;
  fixedT?: number;
  onStage?: (s: ReceiveStage) => void;
  /** Bump to advance the current stage without a gesture (accessibility). */
  advanceKey?: number;
  /** For fixedT frames: which way the envelope is opened. */
  openMode?: OpenedBy;
  onOpened?: (by: OpenedBy) => void;
  /** How the letter inside was folded. */
  fold?: FoldKind;
};

export type OpenedBy = 'slit' | 'seal';

/** On-screen width of an envelope: a DL spans the reading width, other formats keep their real size beside it. */
function envelopeWidth(f: EnvelopeFormat, width: number) {
  const pxPerMm = Math.min(width - 40, 360) / ENVELOPE_MM.DL.w;
  return Math.min(width - 24, Math.round(ENVELOPE_MM[f].w * pxPerMm));
}

/** The seal snaps after 14 pt of pull; until then (break < SNAP) the wax only strains. */
const SNAP = 0.2;
const FLAP_OPEN = Math.PI * 0.985;
const CRUMB_SECONDS = 0.7;

export function ReceivingCeremony({
  width,
  height,
  look,
  address,
  postmark,
  letterFront,
  letterBack,
  sheet,
  flat,
  name = '',
  country = 'ru',
  senderCountry = 'ru',
  waiting = 1,
  others = [],
  startOpen = false,
  fixedT,
  onStage,
  advanceKey,
  openMode = 'slit',
  onOpened,
  fold = 'tri',
}: Props) {
  const faces = useTypefaces();
  const L = useMemo(() => mailboxLayout(width, height, country), [width, height, country]);
  const { door } = L;
  const bank = useMemo(() => faces && recordMailboxBank(L, flat - 4, look.seed, faces.print), [faces, L, flat, look.seed]);
  const doorLabel = country === 'fr' ? name.toUpperCase() : String(flat);
  const doorPics = useMemo(() => faces && recordDoor(L, doorLabel, look.seed + 3, faces.print), [faces, L, doorLabel, look.seed]);

  // The envelope, at the size it is read at: a DL spans the reading width, other formats keep their real size next to it.
  const sizeOf = (f: EnvelopeFormat) => envelopeWidth(f, width);
  const format = look.format ?? 'DL';
  const ew = sizeOf(format);
  const g = useMemo(() => envelopeGeometry(ew, look.seed, format), [ew, look.seed, format]);
  const eh = g.height;
  const parts = useMemo(() => recordEnvelope(g, look.paper, look.liner, look.seed), [g, look.paper, look.liner, look.seed]);
  const front = useMemo(
    () => faces && recordEnvelopeFront(g, look.paper, look.seed, address, postmark, faces, { wear: true, country: senderCountry }),
    [faces, g, look.paper, look.seed, address, postmark, senderCountry],
  );
  // Letters still waiting underneath (at most two are visible).
  const underneath = useMemo(
    () =>
      faces
        ? others
            .slice(0, 2)
            .map((o) => {
              const og = envelopeGeometry(envelopeWidth(o.format ?? 'DL', width), o.seed, o.format ?? 'DL');
              const pic = recordEnvelopeFront(og, o.paper, o.seed, o.address, o.postmark, faces, { wear: true, country: o.senderCountry ?? 'ru' });
              return { pic, w: og.width, h: og.height };
            })
        : [],
    [faces, others, width],
  );
  const letter = useMemo(
    () => recordFoldedLetter(letterFront, letterBack, sheet, look.seed, fold),
    [letterFront, letterBack, sheet, look.seed, fold],
  );
  const edge = useMemo(() => {
    const pts = slitEdge(ew, look.seed);
    const b = Skia.PathBuilder.Make().moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) b.lineTo(pts[i], pts[i + 1]);
    return b.detach();
  }, [ew, look.seed]);
  const catches = useMemo(() => slitCatches(ew, look.seed), [ew, look.seed]);

  // The seal where the sender put it (old letters: today's seal on the flap tip), in envelope px.
  const stored = useMemo(() => look.seal ?? defaultSeal(format, look.seed), [look.seal, format, look.seed]);
  const seal = useMemo(() => sealToPx(stored, g.width, g.height, format, look.seed), [stored, g, format, look.seed]);
  const sealBox = useMemo(() => sealBounds(seal), [seal]);
  // Only a seal across the flap's edge holds it shut and can be broken; otherwise it is decoration.
  const hold = useMemo(() => sealHold(stored, format, look.seed), [stored, format, look.seed]);
  const breakable = hold === 'straddle';
  const die = look.die ?? 'monogram';

  // Breaking the seal: the flap piece (jagged through the wax), the crack, crumbs, torn fibres.
  const broken = useMemo(() => {
    if (!breakable) return null;
    const geo = breakGeometry(g, seal, look.seed);
    const poly = (pts: number[], close: boolean) => {
      const b = Skia.PathBuilder.Make().moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) b.lineTo(pts[i], pts[i + 1]);
      if (close) b.close();
      return b.detach();
    };
    const fibres = Skia.PathBuilder.Make();
    for (const [x0, y0, x1, y1] of fibreTears(g, look.seed)) fibres.moveTo(x0, y0).lineTo(x1, y1);
    const residue = Skia.PathBuilder.Make();
    for (const [x0, y0, x1, y1] of residueFibres(g, seal, look.seed)) residue.moveTo(x0, y0).lineTo(x1, y1);
    return {
      residue: residue.detach(),
      // The faint film flexible wax leaves on the body: its real footprint, a hair inside.
      film: sealOutlinePath(seal),
      flapPiece: poly(geo.flapPiece, true),
      crack: geo.crack.length ? poly(geo.crack, false) : Skia.PathBuilder.Make().detach(),
      // A seal near a corner throws some off the paper: those fall on past it, fading, instead of resting on air.
      crumbs: (geo.crack.length ? makeCrumbs(geo.crack, look.seed) : []).map((c) => ({
        crumb: c,
        off: !crumbLandsOn(c, { x: 0, y: 0, width: g.width, height: g.height }),
      })),
      fibres: fibres.detach(),
    };
  }, [breakable, g, seal, look.seed]);

  // Poses: lying on the floor of the box → held in front of you.
  const rand = mulberry32(subSeed(look.seed, 'mailbox'));
  const inside = { x: door.x + door.w * 0.5, y: door.y + door.h * 0.7, scale: (door.w * 0.86) / sizeOf('DL'), tilt: 1.05, rot: 0.12 + wobble(rand, 0.05) };
  const held = { x: width / 2, y: height * 0.6, scale: 1, tilt: 0, rot: wobble(rand, 0.02) };

  // Brittle sealing wax cracks (in the post, and when opened); flexible wax bends and peels off whole.
  const flexible = look.waxType === 'flexible';

  // ── state ──
  const init = fixedT !== undefined ? splitReceiveT(fixedT) : startOpen ? { values: [1, 0, 0, 0, 0], stage: 1 as ReceiveStage } : splitReceiveT(0);
  const doorV = useSharedValue(init.values[0]);
  const take = useSharedValue(init.values[1]);
  const flip = useSharedValue(init.values[2]);
  const slit = useSharedValue(init.values[3]);
  const pull = useSharedValue(init.values[4]);
  const progress = [doorV, take, flip, slit, pull];
  // A QA frame "opened by the seal" falls back to the knife when the seal can't be broken.
  const sealOpen = openMode === 'seal' && breakable;
  const sealFixed = fixedT !== undefined && sealOpen;
  const breakV = useSharedValue(sealFixed ? init.values[3] : 0);
  const crumbT = useSharedValue(0);
  /** 0: not chosen yet, 1: paper knife, 2: break the seal. */
  const mode = useSharedValue(sealFixed && init.values[3] > 0 ? 2 : 0);
  const stage = useSharedValue<ReceiveStage>(init.stage);
  const gStage = useSharedValue<ReceiveStage>(0);
  const start = useSharedValue(0);
  const settled = useSharedValue(false);
  const slitDir = useSharedValue(1); // 1: left → right, -1: right → left

  useEffect(() => {
    if (fixedT === undefined) return;
    const v = splitReceiveT(fixedT);
    v.values.forEach((x, i) => progress[i].set(x));
    if (sealOpen) {
      // Same timeline, opened by the seal: the knife never moves, crumbs follow the break.
      slit.set(0);
      breakV.set(v.values[3]);
      crumbT.set(clamp01((v.values[3] - SNAP) / 0.35));
      mode.set(v.values[3] > 0 ? 2 : 0);
    }
    stage.set(v.stage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedT]);

  const finish = (i: number, velocity = 0) => {
    'worklet';
    const target = i === 3 && mode.get() === 2 ? breakV : progress[i];
    target.set(withSpring(1, { velocity, damping: 20, stiffness: 150, overshootClamping: true }));
  };
  const back = (i: number, velocity = 0) => {
    'worklet';
    progress[i].set(withSpring(0, { velocity, damping: 20, stiffness: 170, overshootClamping: true }));
  };

  // Only presses made while mounted count (a remount for the next letter keeps the old key).
  const advanceAtMount = useRef(advanceKey);
  useEffect(() => {
    if (!advanceKey || advanceKey === advanceAtMount.current) return;
    const s = stage.get();
    if (s < 5) finish(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advanceKey]);

  const envelopeLeft = held.x - ew / 2;
  // Held in front of you (turned by held.rot) and flipped: back-face px are plain envelope px.
  const cosR = Math.cos(held.rot);
  const sinR = Math.sin(held.rot);
  const toEnvelope = (x: number, y: number) => {
    'worklet';
    const dx = x - held.x;
    const dy = y - held.y;
    return { x: cosR * dx + sinR * dy + ew / 2, y: -sinR * dx + cosR * dy + eh / 2 };
  };
  // The flap is lifted by the seal: the lever arm is how far down the flap it sits.
  const flapTravel = Math.max(eh * 0.35, 1.7 * seal.y);
  const pan = usePanGesture({
    enabled: fixedT === undefined,
    minDistance: 0,
    onBegin: (e) => {
      const s = stage.get();
      gStage.set(s);
      settled.set(false);
      if (s < 5) start.set(progress[s].get());
      if (s === 3 && mode.get() === 0) {
        // Touching a seal that holds the flap means breaking it; anywhere else (or any
        // decorative seal) picks up the paper knife.
        const p = toEnvelope(e.x, e.y);
        const onSeal = breakable && coverSD(seal, p.x, p.y) > -12;
        mode.set(onSeal ? 2 : 1);
        if (!onSeal) slitDir.set(e.x < width / 2 ? 1 : -1);
      }
      if (s === 3 && mode.get() === 2) start.set(breakV.get());
    },
    onUpdate: (e) => {
      const s = gStage.get();
      if (s === 0) doorV.set(clamp01(start.get() + e.translationX / (door.w * 1.1)));
      if (s === 1) take.set(clamp01(start.get() - e.translationY / (height * 0.45)));
      if (s === 3 && mode.get() === 2) {
        const up = Math.max(0, -e.translationY);
        let v: number;
        if (start.get() < SNAP) v = up < 14 ? (SNAP * up) / 14 : SNAP + ((1 - SNAP) * (up - 14)) / flapTravel;
        else v = start.get() + ((1 - SNAP) * -e.translationY) / flapTravel;
        // Once snapped it stays broken.
        breakV.set(clamp01(breakV.get() >= SNAP ? Math.max(SNAP, v) : v));
      } else if (s === 3) {
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
      if (s === 3 && mode.get() === 2) {
        const b = breakV.get();
        const v = (-e.velocityY / flapTravel) * (1 - SNAP);
        // Strained but not snapped: the wax holds. Snapped: the flap opens or falls back.
        if (b < SNAP) breakV.set(withSpring(0, { damping: 18, stiffness: 400, overshootClamping: true }));
        else if (b > 0.55 || v > 0.8) breakV.set(withSpring(1, { velocity: v, damping: 20, stiffness: 150, overshootClamping: true }));
        else breakV.set(withSpring(SNAP, { velocity: v, damping: 14, stiffness: 160, overshootClamping: true }));
      }
      // A slit stays where you left it; near the end the knife runs out on its own.
      if (s === 3 && mode.get() === 1 && slit.get() > 0.92) finish(3);
      // Nothing happened yet: let the next touch choose again.
      if (s === 3 && slit.get() === 0 && breakV.get() === 0) mode.set(0);
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
      if (s === 3 && slit.get() === 0 && breakV.get() === 0) mode.set(0);
    },
  });

  // Stage advance + haptics.
  useAnimatedReaction(
    () => [doorV, take, flip, slit, pull].map((v, i) => (i === 3 ? Math.max(v.get(), breakV.get()) : v.get()) >= 0.97),
    (now, prev) => {
      if (fixedT !== undefined) return;
      const s = stage.get();
      if (s < 5 && now[s] && !(prev && prev[s])) {
        stage.set((s + 1) as ReceiveStage);
        scheduleOnRN([feel.door, feel.crease, feel.tick, feel.tick, feel.crease][s]);
        if (s === 3 && onOpened) scheduleOnRN(onOpened, mode.get() === 2 ? 'seal' : 'slit');
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

  // The snap: one hard haptic, and the crumbs fly.
  useAnimatedReaction(
    () => breakV.get() >= SNAP,
    (snapped, prev) => {
      if (fixedT !== undefined || !snapped || prev !== false) return;
      scheduleOnRN(flexible ? feel.peel : feel.crack);
      if (flexible) return;
      crumbT.set(0);
      crumbT.set(withTiming(1, { duration: CRUMB_SECONDS * 1000, easing: Easing.linear }));
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
  const underneathPose = (i: number, uw: number, uh: number): Transforms3d => [
    { translateX: inside.x + (i + 1) * 5 },
    { translateY: inside.y - (i + 1) * 3 },
    { perspective: 700 },
    { rotateX: inside.tilt },
    { rotate: inside.rot - (i + 1) * 0.06 },
    { scale: inside.scale },
    { translateX: -uw / 2 },
    { translateY: -uh / 2 },
  ];
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
  const knifeShown = useDerivedValue(() => (stage.get() === 3 && slit.get() < 1 && mode.get() !== 2 ? 1 : 0));
  const knifeTransform = useDerivedValue(() => {
    const x = slitDir.get() === 1 ? slit.get() * ew : ew - slit.get() * ew;
    return [{ translateX: x }, { translateY: 1.5 }, { scaleX: slitDir.get() }];
  });
  const gap = useDerivedValue(() => (slit.get() >= 1 ? 1 : 0));

  // ── pull ──
  // Fit inside the envelope: a tri-fold fills its width; a half or quarter fold is narrower.
  const letterScale = Math.min((ew * 0.93) / letter.width, (eh * 0.95) / letter.height);
  const lw = letter.width * letterScale;
  const letterTilt = wobble(rand, 0.012);
  const letterTransform = useDerivedValue(() => {
    const k = pull.get();
    const y0 = eh - letter.height * letterScale - 4;
    const y1 = -letter.height * letterScale - 14;
    return [{ translateX: (ew - lw) / 2 }, { translateY: lerp(y0, y1, k) }, { rotate: letterTilt * k }, { scale: letterScale }];
  });
  // Pictures ignore group opacity: hide the letter with a clip until the envelope is open.
  const letterClip = useDerivedValue(() => (flip.get() >= 1 && slit.get() >= 1 ? BIG : EMPTY));

  // ── seal break ──
  const sealLayers = useDerivedValue(() => (mode.get() === 2 && flip.get() >= 1 ? BIG : EMPTY));
  const strain = useDerivedValue(() => Math.min(1, breakV.get() / SNAP));
  const snapped = useDerivedValue(() => (breakV.get() >= SNAP ? 1 : 0));
  const strainCrack = useDerivedValue(() => (breakV.get() < SNAP ? strain.get() * 0.9 : 0));
  const flapAngle = useDerivedValue(() => ease((breakV.get() - SNAP) / (1 - SNAP)) * FLAP_OPEN);
  const flapTransform = useDerivedValue<Transforms3d>(() => [
    // Under strain the flap rises a hair before it lets go.
    { translateY: breakV.get() < SNAP ? -1.2 * strain.get() : 0 },
    { perspective: 1100 },
    { rotateX: -flapAngle.get() },
  ]);
  // The flap and everything riding on it: its half of the seal, or a flexible seal whole.
  const flapBounds = Skia.XYWHRect(-4, -4, ew + 8, Math.max(g.flapTip, sealBox.maxY) + 6);
  const flapInnerClip = useDerivedValue(() => (flapAngle.get() > Math.PI / 2 ? flapBounds : EMPTY));
  const flapOuterClip = useDerivedValue(() => (flapAngle.get() > Math.PI / 2 ? EMPTY : flapBounds));
  const flapShade = useDerivedValue(() => 0.28 * Math.sin(flapAngle.get()));
  const fibresShown = useDerivedValue(() => snapped.get() * Math.min(1, flapAngle.get() * 3));
  // Flexible wax under strain: stretched across the flap edge where it is still stuck to the body, a bend along that edge.
  const stretch = useDerivedValue(() => [{ scaleY: breakV.get() < SNAP ? 1 + 0.07 * strain.get() : 1 }]);
  const bend = useDerivedValue(() => (breakV.get() < SNAP ? strain.get() * 0.55 : 0));

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
          {underneath.map((u, i) => (
            <Group key={i} transform={underneathPose(underneath.length - 1 - i, u.w, u.h)}>
              <Picture picture={u.pic} />
            </Group>
          ))}
          {waiting > 0 && (
            <Group clip={inBoxClip}>
              <Group transform={poseTransform}>
                <Picture picture={front} />
              </Group>
            </Group>
          )}
          <Rect rect={doorRect} color="#000" opacity={darkness} />
        </Group>

        {/* our door, hinged on its left edge */}
        {/* perspective must share the rotation's transform list: each Group flattens to 2D */}
        <Group>
          <Group origin={{ x: door.x, y: door.y + door.h / 2 }} transform={doorTransform}>
            <Group clip={outsideFace}>
              <Picture picture={doorPics.outside} />
              {/* RU: envelopes show pale through the peek holes — more of them, the fuller the box */}
              {waiting > 0 &&
                L.holes.slice(waiting > 1 ? 0 : 1, waiting > 1 ? 6 : 5).map((h, i) => (
                  <Circle key={i} cx={h.x} cy={h.y} r={h.r * 0.8}>
                    <RadialGradient c={vec(h.x - h.r * 0.3, h.y - h.r * 0.3)} r={h.r * 1.3} colors={['#d9d1bf', '#8f8775']} />
                  </Circle>
                ))}
              {/* FR: a corner of each letter pokes out of the slot (up to three), then a chalked count */}
              {country === 'fr' &&
                Array.from({ length: Math.min(waiting, 3) }, (_, i) => (
                  <SlotCorner key={i} slot={L.slot} index={i} seed={look.seed} />
                ))}
              {country === 'fr' && waiting > 3 && faces && (
                <ChalkCount x={L.slot.x + L.slot.w - 18} y={L.slot.y + L.slot.h + 30} n={waiting - 3} typeface={faces.marker} />
              )}
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
                  <WaxSeal placement={seal} die={die} wax={look.wax} initials={look.initials} seed={look.seed} pour={1} imprint={1} flexible={flexible} cracked={!flexible} />
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
            {/* breaking the seal: the whole opened back, drawn over the intact one (a seal across the flap edge only) */}
            {broken && (
              <Group clip={sealLayers}>
                <Group origin={{ x: ew / 2, y: 0 }} transform={flapTransform}>
                  <Group clip={flapInnerClip}>
                    <Picture picture={parts.flapInner} />
                    <Group clip={g.flap}>
                      <Rect x={0} y={0} width={ew} height={g.flapTip} color="#140c04" opacity={flapShade} />
                    </Group>
                  </Group>
                </Group>
                <Picture picture={parts.interior} />
                <Group transform={letterTransform}>
                  <Picture picture={letter.picture} />
                </Group>
                <Picture picture={parts.pocket} />
                {/* paper fibres torn where the flap was glued */}
                {/* rough, uneven: the top layer of paper came away with the gum */}
                <Path path={broken.fibres} style="stroke" strokeWidth={1.8} strokeCap="round" color="rgba(252, 249, 240, 0.75)" opacity={fibresShown}>
                  <DiscretePathEffect length={2.5} deviation={1.1} seed={look.seed % 97} />
                </Path>
                <Path path={broken.fibres} style="stroke" strokeWidth={0.5} color="rgba(90, 70, 50, 0.3)" opacity={fibresShown} transform={[{ translateY: 1.1 }]}>
                  <DiscretePathEffect length={2} deviation={0.9} seed={(look.seed % 97) + 1} />
                </Path>
                {flexible ? (
                  /* where flexible wax held the body: a faint film and a few lifted fibres */
                  <Group clip={broken.flapPiece} invertClip opacity={snapped}>
                    <Group origin={{ x: seal.x, y: seal.y }} transform={[{ scale: 0.93 }]}>
                      <Path path={broken.film} color={waxColor(look.wax, 0.08)} />
                      <Path path={broken.film} style="stroke" strokeWidth={0.8} color={waxColor(look.wax, 0.12)} />
                    </Group>
                    <Path path={broken.residue} style="stroke" strokeWidth={1.4} strokeCap="round" color="rgba(252, 249, 240, 0.8)">
                      <DiscretePathEffect length={1.5} deviation={0.6} seed={look.seed % 89} />
                    </Path>
                  </Group>
                ) : (
                  <>
                    {/* the half of the seal that stays on the envelope */}
                    <Group clip={broken.flapPiece} invertClip>
                      <WaxSeal placement={seal} die={die} wax={look.wax} initials={look.initials} seed={look.seed} pour={1} imprint={1} flexible={flexible} cracked />
                    </Group>
                    <Path path={broken.crack} style="stroke" strokeWidth={0.9} color="rgba(255, 200, 190, 0.35)" opacity={snapped} transform={[{ translateY: 0.8 }]} />
                  </>
                )}
                {/* the flap, with its half of the seal */}
                <Group origin={{ x: ew / 2, y: 0 }} transform={flapTransform}>
                  <Group clip={flapOuterClip}>
                    <Picture picture={parts.flapOuter} />
                    {flexible ? (
                      /* flexible wax goes with the flap, whole */
                      <Group origin={{ x: seal.x, y: edgeYAt(g, seal.x) }} transform={stretch}>
                        <WaxSeal placement={seal} die={die} wax={look.wax} initials={look.initials} seed={look.seed} pour={1} imprint={1} flexible={flexible} />
                      </Group>
                    ) : (
                      <Group clip={broken.flapPiece}>
                        <WaxSeal placement={seal} die={die} wax={look.wax} initials={look.initials} seed={look.seed} pour={1} imprint={1} flexible={flexible} cracked />
                      </Group>
                    )}
                    <Group clip={g.flap}>
                      <Rect x={0} y={0} width={ew} height={g.flapTip} color="#140c04" opacity={flapShade} />
                    </Group>
                  </Group>
                </Group>
                {flexible ? (
                  <Path path={broken.crack} style="stroke" strokeWidth={3} color="rgba(255, 225, 215, 0.35)" opacity={bend}>
                    <BlurMask blur={1.5} style="normal" />
                  </Path>
                ) : (
                  <>
                    <Path path={broken.crack} style="stroke" strokeWidth={0.8} color="rgba(20, 4, 4, 0.85)" opacity={strainCrack} />
                    {broken.crumbs.map((c, i) => (
                      <WaxCrumb key={i} crumb={c.crumb} off={c.off} t={crumbT} color={WAX[look.wax].rgb} />
                    ))}
                  </>
                )}
              </Group>
            )}
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

/** A chip of wax in flight: closed-form, so a frozen QA frame shows exactly where it is. */
function WaxCrumb({ crumb, off, t, color }: { crumb: Crumb; off: boolean; t: SharedValue<number>; color: Rgb }) {
  const shape = useMemo(() => {
    const b = Skia.PathBuilder.Make();
    crumb.shape.forEach((r, i) => {
      const a = (i / crumb.shape.length) * Math.PI * 2;
      if (i === 0) b.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else b.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    });
    return b.close().detach();
  }, [crumb]);
  const transform = useDerivedValue(() => {
    const p = crumbAt(crumb, t.get() * CRUMB_SECONDS, off);
    return [{ translateX: p.x }, { translateY: p.y }, { rotate: p.angle }];
  });
  // Off the paper it drops away out of sight (past the envelope, into the box).
  const shown = useDerivedValue(() => (t.get() <= 0 ? 0 : off ? 1 - Math.min(1, Math.max(0, (t.get() - 0.35) / 0.5)) : 1));
  const [r, g, b] = color.map((v) => Math.round(v * 255));
  return (
    <Group transform={transform} opacity={shown}>
      <Path path={shape} color={`rgb(${r}, ${g}, ${b})`} />
      <Path path={shape} style="stroke" strokeWidth={0.5} color="rgba(0, 0, 0, 0.35)" />
      <Path path={shape} color="rgba(255, 220, 210, 0.25)" transform={[{ scale: 0.45 }, { translateX: -0.6 }, { translateY: -0.6 }]} />
    </Group>
  );
}

function waxColor(kind: keyof typeof WAX, alpha: number) {
  const [r, g, b] = WAX[kind].rgb.map((v) => Math.round(v * 255));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The edge of a letter that didn't go all the way in, drooping out of the FR slot. */
function SlotCorner({ slot, index, seed }: { slot: { x: number; y: number; w: number; h: number }; index: number; seed: number }) {
  const path = useMemo(() => {
    const rand = mulberry32(subSeed(seed, `corner-${index}`));
    const cw = slot.w * (0.32 + rand() * 0.1);
    const x0 = slot.x + slot.w * (0.18 + 0.2 * index) + wobble(rand, 4);
    const y0 = slot.y + slot.h * 0.55;
    const drop = 7 + rand() * 4 + index * 3;
    const tilt = (index - 1) * 2 * (Math.PI / 180) * cw;
    return Skia.PathBuilder.Make()
      .moveTo(x0, y0)
      .lineTo(x0 + cw, y0 + tilt * 0.2)
      .lineTo(x0 + cw * 0.97, y0 + drop + tilt)
      .lineTo(x0 + cw * 0.04, y0 + drop)
      .close()
      .detach();
  }, [slot, index, seed]);
  return (
    <>
      <Path path={path} color="rgba(0, 0, 0, 0.35)" transform={[{ translateX: 1 }, { translateY: 2.5 }]}>
        <BlurMask blur={2} style="normal" />
      </Path>
      <Path path={path} color={index % 2 ? '#e4dccb' : '#efe8d8'} />
      <Path path={path} style="stroke" strokeWidth={0.6} color="rgba(60, 45, 30, 0.35)" />
    </>
  );
}

/** "+2" chalked by the postman when the box is too full to show every letter. */
function ChalkCount({ x, y, n, typeface }: { x: number; y: number; n: number; typeface: SkTypeface }) {
  const font = useMemo(() => Skia.Font(typeface, 22), [typeface]);
  return (
    <SkiaText x={x} y={y} text={`+${n}`} font={font} color="rgba(236, 234, 226, 0.82)">
      <DiscretePathEffect length={2} deviation={0.5} seed={n} />
    </SkiaText>
  );
}
