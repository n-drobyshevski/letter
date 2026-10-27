import {
  BlurMask,
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Line,
  Path,
  Paint,
  Picture,
  RadialGradient,
  Rect,
  Shadow,
  Skia,
  vec,
  type SkPicture,
  type Transforms3d,
} from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { AppState, Platform, View, useWindowDimensions, type ViewStyle } from 'react-native';
import {
  GestureDetector,
  PointerType,
  useHoverGesture,
  usePanGesture,
  useRotationGesture,
  useSimultaneousGestures,
} from 'react-native-gesture-handler';
import {
  Easing,
  ReduceMotion,
  cancelAnimation,
  interpolate,
  useAnimatedReaction,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { feel } from '../lib/haptics';
import { mulberry32, subSeed, wobble } from '../lib/random';
import { LIGHT_DIR, WAX, type LinerKind, type PaperKind, type WaxKind, type WaxType } from '../theme/stationery';
import { useDieMarkFont } from './DieChip';
import { DieTray, TRAY_MARK, dieLabel } from './DieTray';
import {
  ENVELOPE_MM,
  envelopeGeometry,
  formatForFold,
  pocketPath,
  recordBulge,
  recordEnvelope,
  recordFoldedLetter,
  type EnvelopeFormat,
} from './envelope';
import type { FoldKind } from './fold';
import {
  clampPuddleCentre,
  defaultSeal,
  edgeYAt,
  pressDepth,
  pressTouches,
  sealFromPx,
  sealHold,
  sealToPx,
  type SealDie,
  type SealHold,
  type SealPlacement,
  type SealPx,
} from './seal';
import { useWheelRotate } from './useWheelRotate';
import { WaxSeal } from './WaxSeal';

/**
 * Sealing ceremony, four stages, each driven by its own progress value:
 *   0 insert  drag the folded letter down into the pocket
 *   1 close   drag the flap down (or tap) — it swings over in perspective
 *   2 wax     hold where the seal should go: wax pours exactly there and grows while you
 *             hold (moving steers the stream); then pick a die, tap where to press it (or
 *             drag the stamp there), twist / wheel / buttons to turn it
 *   3 press   the brass die drops, imprints the wax, lifts away
 *   4 sealed  onSealed(placement): where the wax and the die went, to store and send
 *
 * Inside stage 2 a `mode` decides what a touch does (ready → pouring → wax → carry → drop).
 */

export type Stage = 0 | 1 | 2 | 3 | 4;

/** What a touch does inside stage 2. */
export type SealMode = 'ready' | 'pouring' | 'wax' | 'carry' | 'drop';

/** Which hint the screen should show (the screen owns the copy, in the writer's language). */
export type SealHint =
  | 'insert'
  | 'close'
  | 'ready'
  | 'pouring'
  | 'wax'
  | 'carry'
  | 'miss'
  | 'outside'
  | 'press'
  | 'sealed'
  | 'decor';

/** The button alternative to every gesture: bump `n` to run `kind` once (only changes while mounted count). */
export type SealCommandKind = 'insert' | 'close' | 'pour' | 'more' | 'rotateLeft' | 'rotateRight' | 'press' | 'reset';
export type SealCommand = { kind: SealCommandKind; n: number };

export type EnvelopeLook = {
  paper: PaperKind;
  liner: LinerKind;
  wax: WaxKind;
  /** Brittle by default. */
  waxType?: WaxType;
  initials: string;
  seed: number;
  /** DL by default; C5 and C6 for letters folded in half or in four. */
  format?: EnvelopeFormat;
  /** The engraving on the brass die; the monogram (initials) by default. */
  die?: SealDie;
  /** Where the wax and the die went (letters.envelope.seal); absent on old letters → defaultSeal. */
  seal?: SealPlacement;
};

type Props = {
  /** The folded letter, as FoldableLetter's front and back (top sheet's recto, last sheet's verso). */
  letterFront: SkPicture;
  letterBack: SkPicture;
  sheet: { width: number; height: number };
  /** Sheets folded together (a thicker packet). */
  sheets?: number;
  /** How much a thick letter rounds the envelope out once it is in (bulgeFor), 0..1. */
  bulge?: number;
  /** The letter's own seed, where its creases are (defaults to the envelope's). */
  foldSeed?: number;
  /** Width of a DL envelope on screen; C5 and C6 keep their real size next to it. */
  width: number;
  look: EnvelopeLook;
  /** How the letter going in was folded (picks the envelope format unless the look sets one). */
  fold?: FoldKind;
  onStage?: (stage: Stage) => void;
  /** Sealed: the placement as stored in letters.envelope.seal (fractions of the back, mm). */
  onSealed?: (placement: SealPlacement) => void;
  /** Sealed: whether the seal holds the flap (straddle) or is decoration (flap / body). */
  onHold?: (hold: SealHold) => void;
  /** `full`: the puddle has all the wax one seal takes (holding on it adds nothing). */
  onHint?: (hint: SealHint, info?: { full: boolean }) => void;
  /** A die picked in the tray (the tray starts from look.die). */
  onDie?: (die: SealDie) => void;
  /** Button alternatives (see SealCommand). */
  command?: SealCommand;
  /**
   * Reduce Motion or a screen reader: no cooling clock (the wax never sets), and a quick
   * tap before any wax aims the pour button (a crosshair) instead of dripping.
   */
  needsButtons?: boolean;
  /** The writer's language: die names and the canvas's accessibility label. */
  lang?: 'ru' | 'fr';
  /** Freeze the whole ceremony at t ∈ [0, 1] (visual QA); the seal comes from look.seal ?? defaultSeal. */
  fixedT?: number;
  /** Start live from this point of the timeline instead of 0 (0.5: the letter in, the flap shut, no wax yet). */
  startT?: number;
  /** Bump to start over. */
  resetKey?: number;
};

const PERSPECTIVE = 1100;
const FLAP_OPEN = Math.PI * 0.985;
const PAD = 24;

// Thresholds (pt, ms) of the stage-2 state machine.
const TAP_MOVE = 6;
const DRAG_MOVE = 8;
const HOLD_MS = 180;
const FIRST_DROP_MS = 120;
const DRIP = 0.06;
const POUR_MS = 2200;
/** The stamp rides this far above a finger while carried (touch only), so the finger doesn't hide it. */
const CARRY_OFFSET = -56;
const STEP = Math.PI / 12; // 15°
const SNAP = (3 * Math.PI) / 180;
const DEG4 = (4 * Math.PI) / 180;
const MISS_MS = 410;
/** A mouse's die hovers this high (×1.11), see-through, so the wax under it can still be read. */
const HOVER_H = 0.2;
const HOVER_O = 0.45;
/** After the press the die goes this many brass radii towards the light, clear of the seal. */
const LIFT_AWAY = 2.8;
const LIGHT_UNIT = {
  x: LIGHT_DIR.x / Math.hypot(LIGHT_DIR.x, LIGHT_DIR.y),
  y: LIGHT_DIR.y / Math.hypot(LIGHT_DIR.x, LIGHT_DIR.y),
};
const TRAY_H = 52;
/**
 * The pour, the hold clock, cooling and the miss bounce are clocks, not decoration: Reduce
 * Motion (ReduceMotion.System, Reanimated's default) would jump them to their end, so a
 * hold would pour everything at once and every touch would count as a hold.
 */
const CLOCK = ReduceMotion.Never;

/**
 * How wide a sealing screen may draw its widest envelope (pt): the window's width less the
 * gutters, at most 480; never degenerate (a window can report 0 wide for a moment). The
 * canvas is tall (the letter above the envelope), then come the die tray and the buttons,
 * so on a short window (a laptop) it is also kept to what fits the height.
 */
export function sealingFit(format: EnvelopeFormat, screenW: number, screenH: number) {
  const byWidth = Math.min(Math.max(screenW, 320) - 48, 480);
  // Canvas ≈ 1.42 × width + 72 for a C5 (≈ 1.05 × for a DL or a C6); title, hint, tray,
  // buttons and insets ≈ 300. The look choices go under the buttons.
  const byHeight = (Math.max(screenH, 600) - 372) / (format === 'C5' ? 1.42 : 1.05);
  return Math.round(Math.max(Math.min(byWidth, byHeight), Math.min(byWidth, 260)));
}

/**
 * sealingFit for this window, held steady through a ceremony: a phone's toolbar folding
 * away or a small resize doesn't move the envelope under the wax; turning the phone or a
 * real change of the window does (EnvelopeCeremony rescales a seal in progress then).
 */
export function useSealingFit(format: EnvelopeFormat) {
  const { width, height } = useWindowDimensions();
  const [win, setWin] = useState({ width, height, format });
  const changed =
    format !== win.format || Math.abs(width - win.width) > win.width * 0.1 || Math.abs(height - win.height) > win.height * 0.25;
  // Adjusting state while rendering (React's pattern for "from the previous render").
  if (changed) setWin({ width, height, format });
  return changed ? sealingFit(format, width, height) : sealingFit(format, win.width, win.height);
}

function clamp01(x: number) {
  'worklet';
  return Math.min(1, Math.max(0, x));
}
function easeInOut(x: number) {
  'worklet';
  const c = clamp01(x);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}
/** Radians wrapped to [-π, π]. */
function wrap(a: number) {
  'worklet';
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
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

const A11Y = {
  ru: {
    0: 'Открытый конверт, письмо над ним',
    1: 'Письмо в конверте, клапан открыт',
    ready: 'Клапан закрыт, сургуча ещё нет',
    wax: (where: string, die: string) => `Сургуч ${where}, печать: ${die}`,
    sealed: (where: string, die: string) => `Запечатано: сургуч ${where}, печать: ${die}`,
    where: { tip: 'на кончике клапана', edge: 'на краю клапана', flap: 'на клапане', body: 'на конверте под клапаном' },
  },
  fr: {
    0: 'L’enveloppe ouverte, la lettre au-dessus',
    1: 'La lettre dans l’enveloppe, le rabat ouvert',
    ready: 'Le rabat est fermé, pas encore de cire',
    wax: (where: string, die: string) => `Cire ${where}, cachet : ${die}`,
    sealed: (where: string, die: string) => `Cacheté : cire ${where}, cachet : ${die}`,
    where: {
      tip: 'sur la pointe du rabat',
      edge: 'au bord du rabat',
      flap: 'sur le rabat',
      body: 'sur l’enveloppe, sous le rabat',
    },
  },
};

export function EnvelopeCeremony({
  letterFront,
  letterBack,
  sheet,
  sheets = 1,
  bulge = 0,
  foldSeed,
  width,
  look,
  fold = 'tri',
  onStage,
  onSealed,
  onHold,
  onHint,
  onDie,
  command,
  needsButtons = false,
  lang = 'ru',
  fixedT,
  startT = 0,
  resetKey,
}: Props) {
  const format = look.format ?? formatForFold(fold);
  const g = useMemo(
    () =>
      envelopeGeometry(
        format === 'DL' ? width : Math.round((width * ENVELOPE_MM[format].w) / ENVELOPE_MM.DL.w),
        look.seed,
        format,
      ),
    [width, look.seed, format],
  );
  const parts = useMemo(() => recordEnvelope(g, look.paper, look.liner, look.seed), [g, look.paper, look.liner, look.seed]);
  const letter = useMemo(
    () => recordFoldedLetter(letterFront, letterBack, sheet, foldSeed ?? look.seed, fold, sheets),
    [letterFront, letterBack, sheet, foldSeed, look.seed, fold, sheets],
  );
  const fixed = fixedT !== undefined;
  // The stored seal a frozen QA frame shows (keyed by value: callers may rebuild look.seal each render).
  const sealKey = look.seal ? JSON.stringify(look.seal) : '';
  const fixedPx = useMemo(
    () =>
      fixed
        ? sealToPx(
            sealKey ? (JSON.parse(sealKey) as SealPlacement) : defaultSeal(format, look.seed),
            g.width,
            g.height,
            format,
            look.seed,
          )
        : null,
    [fixed, sealKey, format, look.seed, g],
  );

  // Letter placement: seeded crookedness, resting on the bottom of the pocket.
  const rand = mulberry32(subSeed(look.seed, 'insert'));
  const letterX = (g.width - letter.width) / 2 + wobble(rand, 2.5);
  const restRot = wobble(rand, 0.012);
  const startRot = restRot - 0.05 * (rand() > 0.5 ? 1 : -1);
  const yStart = -letter.height - 8;
  const yEnd = g.height - letter.height - g.height * 0.045;
  const top = Math.ceil(letter.height + g.flapTip * 0.2 + PAD);
  // The envelope rounds out over the letter once it is in, and the closed flap over it too.
  const pocket = useMemo(() => pocketPath(g), [g]);
  const bulgePic = useMemo(
    () => recordBulge(g, { x: letterX, y: yEnd, w: letter.width, h: letter.height, rot: restRot }, bulge),
    [g, letterX, yEnd, letter.width, letter.height, restRot, bulge],
  );
  const canvasH = top + g.height + PAD * 2;

  // Sizes in px: a full pour, the die, the brass around it (hovering it's drawn ×1.55).
  const k = g.unit / 110;
  const maxR = g.seal.maxR;
  const stampR = g.seal.stampR;
  const brassR = stampR * 1.12;
  const hoverR = brassR * 1.55;
  // A hand never sets the die perfectly square.
  const restAngle = useMemo(() => wobble(mulberry32(subSeed(look.seed, 'die')), DEG4), [look.seed]);

  // The tray's monogram font, loading from the start (the tray only shows once the flap is shut).
  const trayFont = useDieMarkFont(look.initials, TRAY_MARK);
  const [picked, setPicked] = useState<SealDie | null>(null);
  const die: SealDie = (fixed ? null : picked) ?? look.die ?? 'monogram';

  const insert = useSharedValue(0);
  const close = useSharedValue(0);
  /** Wax poured, 0..1: the puddle's radius is maxR·√v. */
  const v = useSharedValue(0);
  const press = useSharedValue(0);
  const stage = useSharedValue<Stage>(0);
  const mode = useSharedValue<SealMode>('ready');
  const start = useSharedValue(0);
  // A gesture belongs to the stage it started in, even if that stage completes mid-drag.
  const gestureStage = useSharedValue<Stage>(0);
  const gestureStartY = useSharedValue(0);
  const settled = useSharedValue(false);
  const reduceMotion = useReducedMotion();

  // The puddle: its centre, where the first drop landed, the drift stretch, satellite drops.
  const rFull = useSharedValue(maxR);
  const cx = useSharedValue(g.seal.x);
  const cy = useSharedValue(g.seal.y);
  const fx = useSharedValue(g.seal.x);
  const fy = useSharedValue(g.seal.y);
  const stretch = useSharedValue<[number, number]>([0, 0]);
  const drops = useSharedValue<[number, number, number][]>([]);
  const lastDropAt = useSharedValue(0);
  const vPrev = useSharedValue(0);
  const firstPour = useSharedValue(false);
  const steering = useSharedValue(false);
  // The die: where it is (or will go), how it is turned, how warm the wax was when it went in.
  const kx = useSharedValue(g.seal.x);
  const ky = useSharedValue(g.seal.y);
  const angleRaw = useSharedValue(restAngle);
  const angle = useSharedValue(restAngle);
  const rotStart = useSharedValue(0);
  const depth = useSharedValue(1);
  const cool = useSharedValue(0);
  const clockOn = useSharedValue(!fixed && !needsButtons);
  const missT = useSharedValue(0);
  const brassFade = useSharedValue(0);
  // The touch now: where it went down, when, with what, and whether its meaning is decided.
  const down = useSharedValue(false);
  const downX = useSharedValue(0);
  const downY = useSharedValue(0);
  const px = useSharedValue(0);
  const py = useSharedValue(0);
  const touch = useSharedValue(true);
  const decided = useSharedValue(false);
  const ignored = useSharedValue(false);
  const holdClock = useSharedValue(0);
  const grabX = useSharedValue(0);
  const grabY = useSharedValue(CARRY_OFFSET);
  const multi = useSharedValue(false);
  // A mouse over the canvas (laptop): the wax stick tip, or the stamp floating under it.
  const hovering = useSharedValue(false);
  const hx = useSharedValue(0);
  const hy = useSharedValue(0);
  const hoverX = useSharedValue(0);
  const hoverY = useSharedValue(0);
  // Where the buttons pour and press (WCAG 2.5.7): the flap tip until a tap moves it.
  const tx = useSharedValue(g.seal.x);
  const ty = useSharedValue(g.seal.y);
  const aimShown = useSharedValue(false);
  /** A passing hint ('outside', 'miss') until the next touch. */
  const flash = useSharedValue<'' | 'outside' | 'miss'>('');
  const rotOn = useSharedValue(false);
  const buttons = useSharedValue(needsButtons);

  // The JS side's view of the state machine: the tray, the cursor, the accessibility label.
  const [ui, setUi] = useState<{ stage: Stage; mode: SealMode }>({ stage: 0, mode: 'ready' });
  const [where, setWhere] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    buttons.set(needsButtons);
    clockOn.set(!fixed && !needsButtons);
    // No timers for someone who needs the buttons: the wax stays just right.
    if (fixed || needsButtons) {
      cancelAnimation(cool);
      cool.set(0);
    }
  }, [needsButtons, fixed, buttons, clockOn, cool]);

  /** Back to an envelope with no wax on it (stage 2, or `toStage`). */
  const clearSeal = () => {
    'worklet';
    cancelAnimation(v);
    cancelAnimation(press);
    cancelAnimation(cool);
    cancelAnimation(missT);
    cancelAnimation(holdClock);
    v.set(0);
    press.set(0);
    cool.set(0);
    depth.set(1);
    missT.set(0);
    mode.set('ready');
    rFull.set(maxR);
    cx.set(g.seal.x);
    cy.set(g.seal.y);
    fx.set(g.seal.x);
    fy.set(g.seal.y);
    stretch.set([0, 0]);
    drops.set([]);
    kx.set(g.seal.x);
    ky.set(g.seal.y);
    tx.set(g.seal.x);
    ty.set(g.seal.y);
    aimShown.set(false);
    angleRaw.set(restAngle);
    angle.set(restAngle);
    flash.set('');
    down.set(false);
    brassFade.set(0);
  };

  useEffect(() => {
    clearSeal();
    const t = splitT(fixedT ?? startT);
    insert.set(t.insert);
    close.set(t.close);
    press.set(t.press);
    stage.set(t.stage);
    if (fixedPx) {
      // A frozen frame of the stored seal: the puddle grows in place, the die goes where it went.
      rFull.set(fixedPx.r);
      cx.set(fixedPx.x);
      cy.set(fixedPx.y);
      stretch.set(fixedPx.stretch);
      drops.set(fixedPx.drops);
      v.set(t.pour);
      if (fixedPx.stamp) {
        kx.set(fixedPx.stamp.x);
        ky.set(fixedPx.stamp.y);
        angleRaw.set(fixedPx.stamp.angle);
        angle.set(fixedPx.stamp.angle);
        depth.set(fixedPx.stamp.depth);
      }
      mode.set(t.stage === 2 ? 'wax' : t.stage >= 3 ? 'drop' : 'ready');
      if (t.stage === 4) {
        const placement = look.seal ?? defaultSeal(format, look.seed);
        onHint?.(sealHold(placement, format, look.seed) === 'straddle' ? 'sealed' : 'decor');
      }
    }
    onStage?.(t.stage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedT, startT, resetKey, fixedPx]);

  // The window resized mid-ceremony (a phone's toolbar, a laptop window): the seal in
  // progress is held in envelope px, so it scales with the envelope and stays where it was
  // put on the paper (what emitSealed stores is a fraction of the new size).
  const lastWidth = useRef(g.width);
  useEffect(() => {
    const was = lastWidth.current;
    lastWidth.current = g.width;
    if (fixed || was === g.width || was <= 0) return;
    const f = g.width / was;
    for (const sv of [cx, cy, fx, fy, kx, ky, tx, ty, px, py, downX, downY, hx, hy]) sv.set(sv.get() * f);
    drops.set(drops.get().map(([x, y, r]) => [x * f, y * f, r * f] as [number, number, number]));
    rFull.set(maxR);
    setWhere((w) => (w ? { x: w.x * f, y: w.y * f } : w));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.width]);

  const settle = (target: number, velocity: number) => {
    'worklet';
    return reduceMotion
      ? withTiming(target, { duration: 200, easing: Easing.out(Easing.quad) })
      : withSpring(target, { velocity, damping: 20, stiffness: 150, mass: 0.9, overshootClamping: true });
  };

  // ── the puddle as the wax shader and the hit tests see it ──
  const puddleR = () => {
    'worklet';
    return rFull.get() * Math.sqrt(Math.max(v.get(), 0));
  };
  const centre = () => {
    'worklet';
    const R = puddleR();
    // Stored seals are where they were put; a live pour creeps inward as it grows.
    return fixed ? { x: cx.get(), y: cy.get() } : clampPuddleCentre(cx.get(), cy.get(), R, g.width, g.height, k);
  };
  // Read the shared values right here: a mapper only subscribes to what its own closure holds (not helpers').
  const live = useDerivedValue<SealPx>(() => {
    const R = rFull.get() * Math.sqrt(Math.max(v.get(), 0));
    const c = fixed ? { x: cx.get(), y: cy.get() } : clampPuddleCentre(cx.get(), cy.get(), R, g.width, g.height, k);
    const p = press.get();
    const pressed = stage.get() >= 3 && p > 0.4 && (!fixed || fixedPx?.stamp);
    return {
      x: c.x,
      y: c.y,
      r: R,
      stretch: stretch.get(),
      drops: drops.get(),
      stamp: pressed ? { x: kx.get(), y: ky.get(), r: stampR, angle: angle.get(), depth: depth.get() } : null,
      seed: look.seed,
    };
  });
  const imprint = useDerivedValue(() => easeInOut((press.get() - 0.4) / 0.1));
  // Fresh wax is glossy; it goes satin as it cools, and under the die.
  const molten = useDerivedValue(() => Math.min(1 - 0.85 * cool.get(), 1 - 0.85 * imprint.get()));
  const waxShown = useDerivedValue(() => (v.get() > 0 || drops.get().length > 0 ? 1 : 0));

  // ── stage-2 actions (worklets: gestures call them; the buttons call them from JS) ──
  const onEnvelope = (x: number, y: number) => {
    'worklet';
    return x >= 0 && x <= g.width && y >= 0 && y <= g.height;
  };
  /** The stamp's centre, kept where the hovering brass still fits on the canvas. */
  const clampStamp = (x: number, y: number) => {
    'worklet';
    return {
      x: Math.min(g.width + PAD - hoverR, Math.max(hoverR - PAD, x)),
      y: Math.min(g.height + PAD * 2 - hoverR, Math.max(hoverR - top, y)),
    };
  };
  const setStamp = (x: number, y: number) => {
    'worklet';
    const c = clampStamp(x, y);
    kx.set(c.x);
    ky.set(c.y);
  };
  const setAngle = (a: number) => {
    'worklet';
    angleRaw.set(a);
    const w = wrap(a);
    // A detent at upright.
    angle.set(Math.abs(w) < SNAP ? a - w : a);
  };
  const startCooling = () => {
    'worklet';
    if (!clockOn.get()) return;
    const T = (8000 + 6000 * v.get()) * (1 - cool.get());
    cool.set(withTiming(1, { duration: Math.max(1, T), easing: Easing.linear, reduceMotion: CLOCK }));
  };
  const startPour = (x: number, y: number, first: boolean) => {
    'worklet';
    mode.set('pouring');
    firstPour.set(first);
    steering.set(false);
    flash.set('');
    cancelAnimation(cool);
    if (first) {
      const c = clampPuddleCentre(x, y, 0, g.width, g.height, k);
      cx.set(c.x);
      cy.set(c.y);
      fx.set(c.x);
      fy.set(c.y);
      stretch.set([0, 0]);
      drops.set([]);
    } else {
      // A second layer on the first reheats it.
      cool.set(Math.max(0, cool.get() - 0.6));
      scheduleOnRN(feel.tick);
    }
    vPrev.set(v.get());
    const pour = withTiming(1, { duration: POUR_MS * (1 - v.get()), easing: Easing.linear, reduceMotion: CLOCK });
    v.set(first ? withDelay(FIRST_DROP_MS, pour, CLOCK) : pour);
  };
  /** The stream follows the finger, but the puddle stays one puddle. */
  const steer = (x: number, y: number, vx: number, vy: number) => {
    'worklet';
    const vNow = v.get();
    const before = vPrev.get();
    const dv = vNow - before;
    vPrev.set(vNow);
    if (dv <= 0) return;
    const R = puddleR();
    let ox = cx.get();
    let oy = cy.get();
    // The deposit lands on the puddle's edge at most.
    let dx = x - ox;
    let dy = y - oy;
    const d = Math.hypot(dx, dy);
    const lim = Math.max(R, 6);
    if (d > lim) {
      dx *= lim / d;
      dy *= lim / d;
    }
    ox = (ox * before + (ox + dx) * dv) / (before + dv);
    oy = (oy * before + (oy + dy) * dv) / (before + dv);
    // It drifts at most 0.6 maxR from where the first drop fell.
    let ddx = ox - fx.get();
    let ddy = oy - fy.get();
    const drift = Math.hypot(ddx, ddy);
    if (drift > 0.6 * maxR) {
      ddx *= (0.6 * maxR) / drift;
      ddy *= (0.6 * maxR) / drift;
    }
    const c = clampPuddleCentre(fx.get() + ddx, fy.get() + ddy, R, g.width, g.height, k);
    cx.set(c.x);
    cy.set(c.y);
    const nd = Math.hypot(c.x - fx.get(), c.y - fy.get());
    const e = Math.min(0.4, nd / maxR);
    stretch.set(nd > 0.5 ? [((c.x - fx.get()) / nd) * e, ((c.y - fy.get()) / nd) * e] : [0, 0]);
    // A quick flick throws a satellite drop off the stream (two at most).
    const speed = Math.hypot(vx, vy);
    const list = drops.get();
    const now = Date.now();
    if (speed > 120 && list.length < 2 && vNow > 0.15 && now - lastDropAt.get() > 300) {
      const dr = (1 + 1.5 * Math.min(1, (speed - 120) / 600)) * k;
      const ux = x - c.x;
      const uy = y - c.y;
      const ud = Math.hypot(ux, uy);
      if (ud > 0.5) {
        const at = Math.min(Math.max(ud, R + dr * 0.5), R + dr * 2.5);
        const sx = Math.min(g.width - 2 * k, Math.max(2 * k, c.x + (ux / ud) * at));
        const sy = Math.min(g.height - 2 * k, Math.max(2 * k, c.y + (uy / ud) * at));
        drops.set([...list, [sx, sy, dr]]);
        lastDropAt.set(now);
      }
    }
  };
  const endPour = () => {
    'worklet';
    cancelAnimation(v);
    // Lifted before the first drop fell (a quick tap, or a hold through a busy web frame):
    // still a drip (spec: v += 0.06), never 'wax' with nothing on the paper.
    const drip = firstPour.get() && v.get() <= 0 && drops.get().length === 0;
    const R = drip ? rFull.get() * Math.sqrt(DRIP) : puddleR();
    const c = fixed ? { x: cx.get(), y: cy.get() } : clampPuddleCentre(cx.get(), cy.get(), R, g.width, g.height, k);
    cx.set(c.x);
    cy.set(c.y);
    // The buttons press (and turn the stamp) on the puddle.
    tx.set(c.x);
    ty.set(c.y);
    mode.set('wax');
    flash.set('');
    if (drip) v.set(withTiming(DRIP, { duration: 160, easing: Easing.out(Easing.quad), reduceMotion: CLOCK }));
    startCooling();
    scheduleOnRN(setWhere, { x: c.x, y: c.y });
  };
  const enterCarry = (x: number, y: number) => {
    'worklet';
    decided.set(true);
    mode.set('carry');
    grabX.set(0);
    grabY.set(touch.get() ? CARRY_OFFSET : 0);
    multi.set(false);
    setStamp(x + grabX.get(), y + grabY.get());
    scheduleOnRN(feel.tick);
  };
  /** Where «Налить сургуч» will pour (button mode, before any wax). */
  const aim = (x: number, y: number) => {
    'worklet';
    tx.set(x);
    ty.set(y);
  };
  /** Down goes the stamp at (x, y): into the wax, or — off the wax — a bounce off bare paper. */
  const drop = (x: number, y: number) => {
    'worklet';
    setStamp(x, y);
    const c = centre();
    const s: SealPx = { x: c.x, y: c.y, r: puddleR(), stretch: stretch.get(), drops: drops.get(), stamp: null, seed: look.seed };
    mode.set('drop');
    if (!pressTouches(s, { x: kx.get(), y: ky.get(), r: stampR })) {
      // Cold brass leaves nothing on paper.
      missT.set(0);
      missT.set(
        withTiming(1, { duration: MISS_MS, easing: Easing.linear, reduceMotion: CLOCK }, (done) => {
          if (done && mode.get() === 'drop' && stage.get() === 2) mode.set('wax');
        }),
      );
      return;
    }
    cx.set(c.x);
    cy.set(c.y);
    depth.set(clockOn.get() ? pressDepth(cool.get()) : 1);
    stage.set(3);
    press.set(0);
    // Reduce Motion gets its own short press (not a jump: the die still has to meet the wax).
    press.set(withTiming(1, { duration: reduceMotion ? 500 : 1500, easing: Easing.linear, reduceMotion: CLOCK }));
  };

  // Turned with nothing under the mouse (keys, the buttons): show the die where it will go.
  const showAim = () => {
    if (mode.get() === 'wax' && !hovering.get() && !aimShown.get()) {
      setStamp(tx.get(), ty.get());
      aimShown.set(true);
    }
  };

  const insertTravel = yEnd - yStart;
  const pan = usePanGesture({
    enabled: !fixed,
    minDistance: 0,
    onBegin: (e) => {
      const s = stage.get();
      gestureStage.set(s);
      gestureStartY.set(e.y);
      settled.set(false);
      if (s === 0) start.set(insert.get());
      if (s === 1) start.set(close.get());
      if (s !== 2) return;
      const x = e.x - PAD;
      const y = e.y - top;
      touch.set(e.pointerType === PointerType.TOUCH);
      down.set(true);
      downX.set(x);
      downY.set(y);
      px.set(x);
      py.set(y);
      if (!touch.get()) {
        // A mouse or a stylus is where the stick or the hovering die already is: keep them there.
        hx.set(x);
        hy.set(y);
      }
      decided.set(false);
      ignored.set(false);
      flash.set('');
      const m = mode.get();
      if (m === 'ready') {
        if (!onEnvelope(x, y)) {
          // Wax only goes on the envelope.
          ignored.set(true);
          flash.set('outside');
          return;
        }
        startPour(x, y, true);
      } else if (m === 'wax') {
        // The die hovering under a mouse stays under it while the press is decided (no jump).
        if (!touch.get()) setStamp(x, y);
        holdClock.set(0);
        holdClock.set(withDelay(HOLD_MS, withTiming(1, { duration: 1, reduceMotion: CLOCK }), CLOCK));
      } else {
        ignored.set(true);
      }
    },
    onUpdate: (e) => {
      const s = gestureStage.get();
      if (s === 0) insert.set(clamp01(start.get() + e.translationY / insertTravel));
      if (s === 1) close.set(clamp01(start.get() + e.translationY / (g.flapTip * 1.6)));
      if (s !== 2 || ignored.get()) return;
      const x = e.x - PAD;
      const y = e.y - top;
      px.set(x);
      py.set(y);
      if (!touch.get()) {
        hx.set(x);
        hy.set(y);
      }
      const m = mode.get();
      const moved = Math.hypot(x - downX.get(), y - downY.get());
      if (m === 'pouring') {
        if (!steering.get() && moved > DRAG_MOVE) steering.set(true);
        if (steering.get()) steer(x, y, e.velocityX, e.velocityY);
        else vPrev.set(v.get());
      } else if (m === 'wax' && !decided.get()) {
        if (moved > DRAG_MOVE || e.numberOfPointers > 1) {
          cancelAnimation(holdClock);
          enterCarry(x, y);
        }
      } else if (m === 'carry') {
        if (e.numberOfPointers > 1) {
          // Two fingers twist the stamp; it stays put meanwhile.
          multi.set(true);
          return;
        }
        if (multi.get()) {
          // Back to one finger (maybe the other one): carry on from where the stamp is.
          multi.set(false);
          grabX.set(kx.get() - x);
          grabY.set(ky.get() - y);
          return;
        }
        setStamp(x + grabX.get(), y + grabY.get());
      }
    },
    onDeactivate: (e) => {
      const s = gestureStage.get();
      settled.set(true);
      if (s === 0) {
        const vel = e.velocityY / insertTravel;
        insert.set(settle(vel > 0.5 || insert.get() > 0.55 ? 1 : 0, vel));
      }
      if (s === 1) {
        const tap = Math.abs(e.translationY) < 6;
        const vel = e.velocityY / (g.flapTip * 1.6);
        close.set(settle(tap || vel > 0.5 || close.get() > 0.45 ? 1 : 0, vel));
      }
    },
    onFinalize: (e) => {
      // A tap never activates the pan (no movement), so it only shows up here.
      if (gestureStage.get() === 1 && !settled.get() && Math.abs(e.y - gestureStartY.get()) < 6) {
        close.set(settle(1, 0));
        return;
      }
      if (gestureStage.get() !== 2) return;
      // Stage 2 decides everything here: onFinalize runs once on every platform, tap or drag.
      down.set(false);
      cancelAnimation(holdClock);
      if (ignored.get()) return;
      const x = e.x - PAD;
      const y = e.y - top;
      const moved = Math.hypot(x - downX.get(), y - downY.get());
      const m = mode.get();
      if (m === 'pouring') {
        if (firstPour.get() && v.get() <= 0 && buttons.get()) {
          // In button mode a quick tap only aims the pour button (a hold still pours).
          cancelAnimation(v);
          v.set(0);
          mode.set('ready');
          aim(x, y);
          return;
        }
        // Lifted before the stream reached the paper: endPour leaves a single drip.
        endPour();
        return;
      }
      if (m === 'wax' && !decided.get()) {
        // Not decided by the hold clock (an animation, so a busy frame can't turn a tap into a hold) and barely moved: a tap.
        if (e.canceled || moved >= TAP_MOVE) return;
        drop(x, y);
        return;
      }
      if (m === 'carry') {
        // Never commit a cancelled gesture: the stamp goes back to the hand.
        if (e.canceled) mode.set('wax');
        else drop(kx.get(), ky.get());
      }
    },
  });

  const rotation = useRotationGesture({
    enabled: rotOn,
    onBegin: () => {
      rotStart.set(angleRaw.get());
    },
    onUpdate: (e) => {
      setAngle(rotStart.get() + e.rotation);
      if (mode.get() === 'wax') aimShown.set(true);
    },
  });

  const hover = useHoverGesture({
    enabled: !fixed,
    onBegin: (e) => {
      hovering.set(true);
      hx.set(e.x - PAD);
      hy.set(e.y - top);
      hoverX.set(e.x);
      hoverY.set(e.y);
    },
    onUpdate: (e) => {
      hovering.set(true);
      hx.set(e.x - PAD);
      hy.set(e.y - top);
      // The mouse moved on after a button turned the parked die: it follows the mouse again.
      if (aimShown.get() && mode.get() === 'wax' && Math.hypot(e.x - hoverX.get(), e.y - hoverY.get()) > 4) aimShown.set(false);
    },
    onFinalize: () => {
      hovering.set(false);
    },
  });

  const gesture = useSimultaneousGestures(pan, rotation, hover);

  function report(s: Stage, m: SealMode, f: '' | 'outside' | 'miss', full: boolean) {
    setUi((u) => (u.stage === s && u.mode === m ? u : { stage: s, mode: m }));
    if (s === 4) return; // emitSealed (or the frozen frame) says sealed / decor
    const hint: SealHint =
      s === 0
        ? 'insert'
        : s === 1
          ? 'close'
          : s === 3
            ? 'press'
            : f || (m === 'ready' ? 'ready' : m === 'pouring' ? 'pouring' : m === 'carry' ? 'carry' : 'wax');
    onHint?.(hint, { full });
  }

  function emitSealed(s: SealPx) {
    const placement = sealFromPx(s, g.width, g.height, format);
    setWhere({ x: s.x, y: s.y });
    onSealed?.(placement);
    const hold = sealHold(placement, format, look.seed);
    onHold?.(hold);
    onHint?.(hold === 'straddle' ? 'sealed' : 'decor');
  }

  // A hold on the wax pours more; a hold anywhere else picks up the stamp.
  useAnimatedReaction(
    () => holdClock.get() >= 1,
    (now, prev) => {
      if (!now || prev) return;
      if (!down.get() || decided.get() || ignored.get() || mode.get() !== 'wax' || gestureStage.get() !== 2) return;
      decided.set(true);
      const c = centre();
      if (Math.hypot(px.get() - c.x, py.get() - c.y) <= puddleR() + 8) {
        downX.set(px.get());
        downY.set(py.get());
        startPour(px.get(), py.get(), false);
      } else enterCarry(px.get(), py.get());
    },
  );

  // Stage transitions + haptics on forward crossings.
  useAnimatedReaction(
    () => [insert.get() > 0.995, close.get() > 0.995, press.get() >= 1] as const,
    ([inserted, closed, pressed], prev) => {
      if (fixed) return;
      if (inserted && !prev?.[0] && stage.get() === 0) {
        stage.set(1);
        scheduleOnRN(feel.crease);
      }
      if (closed && !prev?.[1] && stage.get() === 1) {
        stage.set(2);
        scheduleOnRN(feel.tick);
      }
      if (pressed && !prev?.[2] && stage.get() === 3) {
        stage.set(4);
        scheduleOnRN(emitSealed, live.get());
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
    () => [stage.get(), mode.get(), flash.get()] as const,
    ([s, m, f], prev) => {
      if (prev && s === prev[0] && m === prev[1] && f === prev[2]) return;
      rotOn.set(!fixed && s === 2 && (m === 'wax' || m === 'carry'));
      scheduleOnRN(report, s, m, f, v.get() >= 0.999);
    },
  );
  // The first drop landing, then every 0.2 of wax.
  useAnimatedReaction(
    () => (v.get() <= 0 ? -1 : Math.floor(v.get() / 0.2)),
    (n, prev) => {
      if (prev !== null && n > prev && stage.get() === 2 && !fixed) scheduleOnRN(feel.tick);
    },
  );
  useAnimatedReaction(
    () => press.get() >= 0.4,
    (hit, prev) => {
      if (!hit || prev !== false) return;
      scheduleOnRN(feel.press);
      // How warm the wax still was decides how deep the die goes.
      if (clockOn.get()) depth.set(pressDepth(cool.get()));
      cancelAnimation(cool);
    },
  );
  // A miss: the brass taps bare paper.
  useAnimatedReaction(
    () => missT.get() >= 0.39,
    (hit, prev) => {
      if (!hit || prev !== false) return;
      flash.set('miss');
      scheduleOnRN(feel.tick);
    },
  );
  // Turning: a soft click every 15°, a firmer one when it settles upright. Only for a turn
  // of the die in hand (wax or carry): «Заново» putting the angle back is not a turn.
  const turning = () => {
    'worklet';
    return !fixed && stage.get() === 2 && (mode.get() === 'wax' || mode.get() === 'carry');
  };
  useAnimatedReaction(
    () => Math.floor(angle.get() / STEP),
    (n, prev) => {
      if (prev !== null && n !== prev && turning()) scheduleOnRN(feel.fibre);
    },
  );
  useAnimatedReaction(
    () => Math.abs(wrap(angle.get())) < 1e-6,
    (upright, prev) => {
      if (upright && prev === false && turning()) scheduleOnRN(feel.crease);
    },
  );

  // Cooling stops while the app is in the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') cancelAnimation(cool);
      else if (stage.get() === 2 && mode.get() === 'wax') startCooling();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The buttons. Only presses made while mounted count (a remount keeps the old key).
  const commandAtMount = useRef(command?.n);
  useEffect(() => {
    if (!command || fixed || command.n === commandAtMount.current) return;
    // A passing 'outside' / 'miss' hint is about the last touch: a button moves on from it.
    flash.set('');
    const s = stage.get();
    const m = mode.get();
    switch (command.kind) {
      case 'insert':
        if (s === 0) insert.set(settle(1, 0));
        break;
      case 'close':
        if (s === 1) close.set(settle(1, 0));
        break;
      case 'pour':
        if (s === 2 && m === 'ready') {
          // A good pour (v = 0.75) at the target, the flap tip unless a tap moved it.
          startPour(tx.get(), ty.get(), true);
          cancelAnimation(v);
          v.set(withTiming(0.75, { duration: 600, easing: Easing.inOut(Easing.quad) }, (done) => done && endPour()));
          scheduleOnRN(feel.tick);
          break;
        }
      // falls through: on wax, «Налить» adds more
      case 'more':
        if (s === 2 && m === 'wax' && v.get() < 1) {
          cancelAnimation(cool);
          cool.set(Math.max(0, cool.get() - 0.6));
          mode.set('pouring');
          v.set(
            withTiming(
              Math.min(1, v.get() + 0.15),
              { duration: 300, easing: Easing.out(Easing.quad) },
              (done) => done && endPour(),
            ),
          );
          scheduleOnRN(feel.tick);
        }
        break;
      case 'rotateLeft':
      case 'rotateRight':
        if (s === 2 && (m === 'wax' || m === 'carry')) {
          showAim();
          setAngle(angleRaw.get() + (command.kind === 'rotateRight' ? STEP : -STEP));
        }
        break;
      case 'press':
        if (s === 2 && m === 'wax') drop(tx.get(), ty.get());
        break;
      case 'reset':
        if (s >= 2) {
          clearSeal();
          stage.set(2);
        }
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.n]);

  // Laptop: the wheel turns the stamp over the canvas, [ and ] by 15°.
  const wrapRef = useRef<ComponentRef<typeof View>>(null);
  useWheelRotate(wrapRef, {
    active: () => !fixed && stage.get() === 2 && (mode.get() === 'wax' || mode.get() === 'carry'),
    onRotate: (rad) => {
      showAim();
      setAngle(angleRaw.get() + rad);
    },
    onStep: (dir) => {
      showAim();
      setAngle(angleRaw.get() + dir * STEP);
    },
  });

  // ── letter ──
  const letterTransform = useDerivedValue(() => {
    const kk = easeInOut(insert.get());
    return [
      { translateX: letterX },
      { translateY: yStart + (yEnd - yStart) * kk },
      { rotate: startRot + (restRot - startRot) * kk },
    ];
  });

  const pocketBulge = useDerivedValue(() => clamp01((insert.get() - 0.8) / 0.2));
  const flapBulge = useDerivedValue(() => clamp01((close.get() - 0.85) / 0.15) * pocketBulge.get());

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

  // ── brass seal: where it is, how high, how visible ──
  // In stage 2 it shows while carried, floating under a mouse, or waiting at the target (turned, aimed).
  const brassWanted = useDerivedValue(() => {
    if (stage.get() !== 2) return 0;
    const m = mode.get();
    if (m === 'carry' || m === 'drop') return 1;
    // A mouse keeps the die in sight through the press (a finger hides it until it decides).
    if (m === 'wax') return (hovering.get() && !down.get()) || (down.get() && !touch.get()) || aimShown.get() ? 1 : 0;
    return 0;
  });
  useAnimatedReaction(
    () => brassWanted.get(),
    (want, prev) => {
      if (prev === null || want === prev) return;
      brassFade.set(fixed ? want : withTiming(want, { duration: 140 }));
    },
  );
  const brass = useDerivedValue(() => {
    const s = stage.get();
    if (s >= 3) {
      if (fixed && !fixedPx?.stamp) return { h: 0, o: 0, ring: 0, squash: 1, x: kx.get(), y: ky.get() };
      const p = press.get();
      const lift = p < 0.62 ? 0 : easeInOut((p - 0.62) / 0.38);
      const h = p < 0.4 ? 1 - Math.pow(p / 0.4, 2) : lift; // falls: ease in
      const squash = p > 0.4 && p < 0.62 ? 0.985 : 1;
      const o0 = p <= 0 ? 0 : Math.min(1, p / 0.08);
      // Reduce Motion: a short crossfade. Otherwise the die is lifted up and away towards the
      // light, opaque (brass is never see-through), fading only once it has cleared the seal.
      if (reduceMotion) return { h, o: o0 * (1 - lift), ring: 0, squash, x: kx.get(), y: ky.get() };
      const away = LIFT_AWAY * brassR * lift * lift;
      const o = o0 * (1 - clamp01((lift - 0.75) / 0.25));
      return { h, o, ring: 0, squash, x: kx.get() + LIGHT_UNIT.x * away, y: ky.get() + LIGHT_UNIT.y * away };
    }
    if (s !== 2) return { h: 1, o: 0, ring: 0, squash: 1, x: kx.get(), y: ky.get() };
    const m = mode.get();
    if (m === 'drop') {
      // A miss: down onto bare paper, a little bounce, back into the hand.
      const t = missT.get();
      const h = t < 0.4 ? 1 - Math.pow(t / 0.4, 2) : 0.7 * Math.sin((Math.PI / 2) * ((t - 0.4) / 0.6));
      return { h, o: t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6, ring: 0, squash: 1, x: kx.get(), y: ky.get() };
    }
    // A mouse over the wax: the die floats just above it, see-through, so the wax (and how
    // far it has set) stays readable; a crisp ring marks where its face will land.
    if (m === 'wax' && !aimShown.get() && ((hovering.get() && !down.get()) || (down.get() && !touch.get()))) {
      const c = down.get() ? { x: kx.get(), y: ky.get() } : clampStamp(hx.get(), hy.get());
      return { h: HOVER_H, o: brassFade.get() * HOVER_O, ring: brassFade.get(), squash: 1, x: c.x, y: c.y };
    }
    return { h: 1, o: brassFade.get(), ring: 0, squash: 1, x: kx.get(), y: ky.get() };
  });
  const stampOpacity = useDerivedValue(() => brass.get().o);
  const ringOpacity = useDerivedValue(() => brass.get().ring);
  const ringTransform = useDerivedValue(() => [{ translateX: brass.get().x }, { translateY: brass.get().y }]);
  const stampTransform = useDerivedValue(() => {
    const b = brass.get();
    const sc = (1 + 0.55 * b.h) * b.squash;
    return [{ translateX: b.x }, { translateY: b.y - 10 * b.h }, { scale: sc }, { rotate: angle.get() }];
  });
  const stampShadowTransform = useDerivedValue(() => {
    const { h, x, y } = brass.get();
    return [{ translateX: x + 2 + 14 * h }, { translateY: y + 3 + 22 * h }];
  });
  const stampShadowBlur = useDerivedValue(() => 2 + 9 * brass.get().h);
  const stampShadowOpacity = useDerivedValue(() => stampOpacity.get() * (0.5 - 0.25 * brass.get().h));

  // ── the wax stick's molten tip under a mouse: before any wax, and while it pours (the
  // puddle grows under the stick, not out of nothing); it fades as the stick is lifted ──
  const ghostFade = useSharedValue(0);
  useAnimatedReaction(
    () => {
      if (fixed || stage.get() !== 2) return 0;
      const m = mode.get();
      if (m === 'pouring') return down.get() && !touch.get() ? 1 : 0;
      return m === 'ready' && hovering.get() && !down.get() && onEnvelope(hx.get(), hy.get()) ? 1 : 0;
    },
    (want, prev) => {
      if (want === prev) return;
      ghostFade.set(want ? want : withTiming(0, { duration: 150 }));
    },
  );
  const ghostOpacity = useDerivedValue(() => ghostFade.get() * 0.92);
  const ghostTransform = useDerivedValue(() => [{ translateX: hx.get() }, { translateY: hy.get() }]);
  const wax = WAX[look.wax].rgb;
  const waxColor = (m: number, a = 1) =>
    `rgba(${Math.round(Math.min(1, wax[0] * m) * 255)}, ${Math.round(Math.min(1, wax[1] * m) * 255)}, ${Math.round(Math.min(1, wax[2] * m) * 255)}, ${a})`;

  // Whether something stands in for the mouse pointer now (the JS side hides the cursor then).
  const [standIn, setStandIn] = useState(false);
  useAnimatedReaction(
    () => {
      if (fixed || stage.get() !== 2) return false;
      const m = mode.get();
      const mouseDown = down.get() && !touch.get();
      if (m === 'ready') return hovering.get() && !down.get() && onEnvelope(hx.get(), hy.get());
      if (m === 'pouring' || m === 'carry') return mouseDown;
      if (m === 'wax') return !aimShown.get() && ((hovering.get() && !down.get()) || mouseDown);
      return false;
    },
    (now, prev) => {
      if (now !== prev && Platform.OS === 'web') scheduleOnRN(setStandIn, now);
    },
  );

  // ── the target crosshair (button mode) ──
  const crossOpacity = useDerivedValue(() => (needsButtons && stage.get() === 2 && mode.get() === 'ready' ? 0.85 : 0));
  const crossTransform = useDerivedValue(() => [{ translateX: tx.get() }, { translateY: ty.get() }]);
  const notch = useMemo(
    () =>
      Skia.PathBuilder.Make()
        .moveTo(-brassR * 0.11, -brassR + 0.6)
        .lineTo(brassR * 0.11, -brassR + 0.6)
        .lineTo(0, -brassR * 0.8)
        .close()
        .detach(),
    [brassR],
  );

  const envelopeTransform = [{ translateX: PAD }, { translateY: top }];

  // The accessibility label says where the wax is and which die.
  const describe = (p: { x: number; y: number }) => {
    const w = A11Y[lang].where;
    if (Math.hypot(p.x - g.tip.x, p.y - g.tip.y) < maxR * 1.2) return w.tip;
    const edge = edgeYAt(g, p.x);
    if (Math.abs(p.y - edge) < maxR * 0.8) return w.edge;
    return p.y < edge ? w.flap : w.body;
  };
  const dieName = dieLabel(die, lang);
  const at = fixedPx ?? where;
  const label =
    ui.stage === 0
      ? A11Y[lang][0]
      : ui.stage === 1
        ? A11Y[lang][1]
        : ui.stage === 4 && at
          ? A11Y[lang].sealed(describe(at), dieName)
          : at && ui.mode !== 'ready'
            ? A11Y[lang].wax(describe(at), dieName)
            : A11Y[lang].ready;

  // The object is the cursor (laptop): hide the system one only while the stick or the die is drawn under it.
  const cursorNone = Platform.OS === 'web' && !fixed && standIn;
  const wrapStyle = { width: g.width + PAD * 2, height: canvasH, ...(cursorNone ? { cursor: 'none' } : null) } as ViewStyle;

  const pickDie = (d: SealDie) => {
    setPicked(d);
    feel.crease();
    onDie?.(d);
  };

  return (
    <>
      <View ref={wrapRef} style={wrapStyle} accessible accessibilityRole="image" accessibilityLabel={label}>
        <GestureDetector gesture={gesture}>
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
              {bulge > 0 && (
                <Group clip={pocket} layer={<Paint opacity={pocketBulge} />}>
                  <Picture picture={bulgePic} />
                </Group>
              )}
              <Group clip={g.flap}>
                <Rect x={0} y={0} width={g.width} height={g.height} color="#140c04" opacity={flapCast} />
              </Group>

              {/* closed flap, outer side: over everything */}
              <Group origin={{ x: g.width / 2, y: 0 }} transform={flapTransform}>
                <Group clip={outerClip}>
                  <Picture picture={parts.flapOuter} />
                  {bulge > 0 && (
                    <Group clip={g.flap} layer={<Paint opacity={flapBulge} />}>
                      <Picture picture={bulgePic} />
                    </Group>
                  )}
                  <Group clip={g.flap}>
                    <Rect x={0} y={0} width={g.width} height={g.flapTip} color="#140c04" opacity={flapShade} />
                  </Group>
                </Group>
              </Group>

              {/* sealing wax, wherever it was poured */}
              <Group opacity={waxShown}>
                <WaxSeal
                  placement={live}
                  die={die}
                  initials={look.initials}
                  wax={look.wax}
                  seed={look.seed}
                  pour={1}
                  imprint={imprint}
                  molten={molten}
                  dieR={stampR}
                  flexible={look.waxType === 'flexible'}
                />
              </Group>

              {/* where the buttons will pour or press */}
              <Group transform={crossTransform} opacity={crossOpacity}>
                <Circle cx={0} cy={0} r={7} style="stroke" strokeWidth={1.2} color="rgba(40, 30, 60, 0.8)" />
                <Line p1={vec(-13, 0)} p2={vec(-4, 0)} strokeWidth={1.2} color="rgba(40, 30, 60, 0.8)" />
                <Line p1={vec(4, 0)} p2={vec(13, 0)} strokeWidth={1.2} color="rgba(40, 30, 60, 0.8)" />
                <Line p1={vec(0, -13)} p2={vec(0, -4)} strokeWidth={1.2} color="rgba(40, 30, 60, 0.8)" />
                <Line p1={vec(0, 4)} p2={vec(0, 13)} strokeWidth={1.2} color="rgba(40, 30, 60, 0.8)" />
              </Group>

              {/* the stick of sealing wax under the mouse, its tip molten */}
              <Group transform={ghostTransform} opacity={ghostOpacity}>
                <Line p1={vec(7, 11)} p2={vec(30, 46)} strokeWidth={9} strokeCap="round" color="rgba(20, 8, 4, 0.35)">
                  <BlurMask blur={3} style="normal" />
                </Line>
                <Line p1={vec(3, 5)} p2={vec(24, 38)} strokeWidth={8} strokeCap="round" color={waxColor(0.8)} />
                <Line p1={vec(2, 3)} p2={vec(22, 35)} strokeWidth={2} strokeCap="round" color={waxColor(1.6, 0.5)} />
                <Circle cx={0} cy={0} r={4.2} color={waxColor(1.25)} />
                <Circle cx={-1.2} cy={-1.3} r={1.3} color="rgba(255, 240, 225, 0.75)" />
              </Group>

              {/* brass seal, seen from above */}
              <Group transform={stampShadowTransform} opacity={stampShadowOpacity}>
                <Circle cx={0} cy={0} r={brassR} color="#1a0f06">
                  <BlurMask blur={stampShadowBlur} style="normal" />
                </Circle>
              </Group>
              <Group transform={stampTransform} opacity={stampOpacity}>
                <Circle cx={0} cy={0} r={brassR}>
                  <RadialGradient
                    c={vec(-brassR * 0.35, -brassR * 0.4)}
                    r={brassR * 1.5}
                    colors={['#f1dc9c', '#c49a45', '#7a5a22', '#4d3714']}
                  />
                </Circle>
                <Circle cx={0} cy={0} r={brassR - 1.5} style="stroke" strokeWidth={3} color="rgba(60, 40, 10, 0.55)">
                  <DashPathEffect intervals={[1.6, 1.6]} />
                </Circle>
                {/* the marked top: which way is up on the die */}
                <Path path={notch} color="rgba(40, 24, 6, 0.85)" />
                <Circle cx={0} cy={0} r={brassR * 0.62}>
                  <RadialGradient
                    c={vec(-brassR * 0.2, -brassR * 0.25)}
                    r={brassR * 0.75}
                    colors={['#9a6a40', '#5e3a1f', '#2e1a0c']}
                  />
                </Circle>
                <Circle cx={-brassR * 0.18} cy={-brassR * 0.2} r={brassR * 0.16} color="rgba(255, 235, 200, 0.22)">
                  <BlurMask blur={3} style="normal" />
                </Circle>
              </Group>
              {/* where the hovering die's face will land */}
              <Group transform={ringTransform} opacity={ringOpacity}>
                <Circle cx={0} cy={0} r={stampR + 0.6} style="stroke" strokeWidth={0.8} color="rgba(255, 238, 205, 0.55)" />
                <Circle cx={0} cy={0} r={stampR} style="stroke" strokeWidth={1} color="rgba(40, 24, 6, 0.8)" />
              </Group>
            </Group>
          </Canvas>
        </GestureDetector>
      </View>
      {/* the dies, from the moment the flap is shut until the brass touches the wax */}
      <View style={{ height: TRAY_H, justifyContent: 'center' }}>
        {ui.stage === 2 && (
          <DieTray
            die={die}
            wax={look.wax}
            initials={look.initials}
            lang={lang}
            width={g.width + PAD * 2 - 8}
            disabled={ui.mode === 'drop'}
            font={trayFont}
            onPick={pickDie}
          />
        )}
      </View>
    </>
  );
}
