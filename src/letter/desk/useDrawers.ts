import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useHoverGesture, usePanGesture, useSimultaneousGestures } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  ReduceMotion,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type DerivedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { feel } from '../../lib/haptics';
import { rubber, settleTarget, SPRING_CLOSE, SPRING_OPEN, SPRING_TAP, TAP } from './motion';
import { DRAWERS, type DeskLayout, type DrawerKey } from './types';

/**
 * The three drawers' motion (spec §3.3): one progress `t ∈ [0, 1]` per drawer (a little past 1 while
 * pulled against the stop), a down-tug per drawer (pt, at most ~6), and `open`, the drawer that is open
 * or opening. Everything runs on the UI thread; React only hears when `open` or the drawer on show changes.
 *
 * - Drag a front up: it follows the finger 1:1 over its travel D; release settles by projection and velocity.
 * - Tug it down (a stuck drawer giving way) or tap it: it opens. Tap or push an open one: it closes.
 * - A gesture locks to the front it began on; opening another drawer closes the open one in parallel.
 * - Web: hovering a closed front eases it out a hair (`peek`, its own value: the camera never moves for it);
 *   `cursor: grab` / `grabbing`.
 * - Haptics on forward crossings only: `knock` at the stop, `shut` when pushed home after being open.
 */

export type DrawerValues = {
  t: Record<DrawerKey, SharedValue<number>>;
  tug: Record<DrawerKey, SharedValue<number>>;
  /** Web hover: 0 → 1 eases that closed front out a hair (a few pt) and lifts its card; nothing else moves. */
  peek: Record<DrawerKey, SharedValue<number>>;
  /** The drawer open or opening (the one a release, a tap or a call settled toward 1), or null. */
  open: SharedValue<DrawerKey | null>;
  /** The front under a finger or a button press (it darkens a shade). */
  held: SharedValue<DrawerKey | null>;
  /** Camera pan (pt): max(tᵢ · Cᵢ), with the overshoot capped at the rubber band. 0 under Reduce Motion. */
  lift: DerivedValue<number>;
};

export type Drawers = DrawerValues & {
  /** React mirrors: the drawer open (or opening), and the one on show (moving or open; its box goes on top). */
  openKey: DrawerKey | null;
  shown: DrawerKey | null;
  /** The front being dragged (web cursor). */
  dragging: DrawerKey | null;
  /** The fronts' gestures (pan + hover), one per drawer. */
  gestures: Record<DrawerKey, ReturnType<typeof useSimultaneousGestures>>;
  openDrawer: (key: DrawerKey) => void;
  closeAll: (instant?: boolean) => void;
  toggle: (key: DrawerKey) => void;
  /** The first-visit hint: the paper drawer breathes out 6 % and back. */
  breathe: () => void;
};

type Options = {
  layout: DeskLayout;
  /** Reduce Motion: drawers crossfade (150 ms timings), no hover ease, no breath. */
  rm: boolean;
  /** Fronts take gestures (not while a sheet turns, the keyboard is up, or a QA frame is frozen). */
  enabled: boolean;
  /** QA: a drawer frozen at t. */
  fixed?: { drawer?: DrawerKey; t?: number };
  /** A drawer starts opening (any path): the screen dismisses the keyboard. */
  onOpening?: (key: DrawerKey) => void;
};

/** A drawer settling toward 0 or 1: springs (open bounces a hair on its stop; close is soft), or 150 ms under Reduce Motion. */
function settle(t: SharedValue<number>, target: 0 | 1, velocity: number, tap: boolean, rm: boolean) {
  'worklet';
  if (rm) {
    t.set(withTiming(target, { duration: 150, reduceMotion: ReduceMotion.Never }));
    return;
  }
  if (tap) t.set(withSpring(target, { ...SPRING_TAP, overshootClamping: target === 0 }));
  else t.set(withSpring(target, { ...(target === 1 ? SPRING_OPEN : SPRING_CLOSE), velocity }));
}

type Ctx = {
  t: Record<DrawerKey, SharedValue<number>>;
  tug: Record<DrawerKey, SharedValue<number>>;
  peek: Record<DrawerKey, SharedValue<number>>;
  open: SharedValue<DrawerKey | null>;
  held: SharedValue<DrawerKey | null>;
  rm: boolean;
};

/** Opens `key` and pushes any other drawer shut at the same time. */
function openW(c: Ctx, key: DrawerKey, velocity: number, tap: boolean) {
  'worklet';
  c.open.set(key);
  // The hover's hair of travel gives way to the real thing.
  if (c.peek[key].get() > 0) c.peek[key].set(withTiming(0, { duration: 160 }));
  for (const k of DRAWERS) if (k !== key && c.t[k].get() > 0) settle(c.t[k], 0, 0, true, c.rm);
  settle(c.t[key], 1, velocity, tap, c.rm);
}

function closeW(c: Ctx, key: DrawerKey, velocity: number, tap: boolean) {
  'worklet';
  if (c.open.get() === key) c.open.set(null);
  settle(c.t[key], 0, velocity, tap, c.rm);
}

function toggleW(c: Ctx, key: DrawerKey) {
  'worklet';
  if (c.open.get() === key) closeW(c, key, 0, true);
  else openW(c, key, 0, true);
}

/** One front's pan and hover. */
function useFront(
  key: DrawerKey,
  c: Ctx,
  D: number,
  enabled: boolean,
  onGrab: (key: DrawerKey, on: boolean) => void,
  onOpening: (key: DrawerKey) => void,
) {
  const t = c.t[key];
  const tug = c.tug[key];
  const startT = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startMs = useSharedValue(0);
  const active = useSharedValue(false);
  // The drag is measured from where the pointer went down (`absoluteY − startY`), not RNGH's translation:
  // on web that restarts at activation, so the front would trail the pointer by the 6 pt slop.
  // The finger's own speed (pt/s), for when the release event reports none (web touch releases do).
  const lastY = useSharedValue(0);
  const lastMs = useSharedValue(0);
  const speed = useSharedValue(0);
  // The furthest a tug went (pt): the release event can lag the last move.
  const tugMax = useSharedValue(0);
  /** A tug released (its pull in pt, ≥ 0) waiting for onFinalize to decide; −1 otherwise. */
  const tugged0 = useSharedValue(-1);
  const rm = c.rm;

  const pan = usePanGesture({
    enabled,
    activeOffsetY: [-TAP.maxMove, TAP.maxMove],
    failOffsetX: [-20, 20],
    onBegin: (e) => {
      // A moving front is caught where it is (settling → dragging).
      cancelAnimation(t);
      cancelAnimation(tug);
      tug.set(0);
      startT.set(Math.min(1, t.get()));
      startX.set(e.absoluteX);
      startY.set(e.absoluteY);
      startMs.set(Date.now());
      lastY.set(0);
      lastMs.set(Date.now());
      speed.set(0);
      tugMax.set(0);
      tugged0.set(-1);
      active.set(false);
      c.held.set(key);
    },
    onActivate: (e) => {
      active.set(true);
      lastY.set(e.absoluteY - startY.get());
      scheduleOnRN(onGrab, key, true);
    },
    onUpdate: (e) => {
      if (!active.get()) return;
      const dy = e.absoluteY - startY.get();
      const now = Date.now();
      const dt = now - lastMs.get();
      if (dt > 0) {
        speed.set(0.5 * speed.get() + (0.5 * (dy - lastY.get()) * 1000) / dt);
        lastY.set(dy);
        lastMs.set(now);
      }
      const raw = startT.get() - dy / D;
      tugMax.set(Math.max(tugMax.get(), dy));
      if (raw > 1) {
        // Against the stop: a rubber band, never more than ~6 pt.
        t.set(1 + rubber((raw - 1) * D, 10) / D);
        tug.set(0);
      } else if (raw < 0) {
        t.set(0);
        tug.set(rubber(-raw * D, 10));
      } else {
        t.set(raw);
        tug.set(0);
      }
      // Pulling this one out pushes the open one shut, in parallel.
      const o = c.open.get();
      if (raw > 0.02 && o !== null && o !== key) {
        c.open.set(null);
        settle(c.t[o], 0, 0, true, rm);
        scheduleOnRN(onOpening, key);
      }
    },
    onDeactivate: (e) => {
      // A finger that stopped well before lifting has no speed left.
      const vy = e.velocityY !== 0 ? e.velocityY : Date.now() - lastMs.get() > 250 ? 0 : speed.get();
      const tugged = tug.get();
      if (tugged !== 0) tug.set(rm ? 0 : withSpring(0, SPRING_TAP));
      // Never commit a cancelled gesture: back to where it began.
      if (e.canceled) {
        if (startT.get() > 0.5) openW(c, key, 0, true);
        else closeW(c, key, 0, true);
        return;
      }
      if (startT.get() < 0.05 && t.get() <= 0.0001) {
        // A tug on a closed drawer: a stuck drawer giving way, or nothing. Decided in onFinalize, whose
        // pointer position is the release's own (this event can lag the last moves on web).
        tugged0.set(vy > 300 ? 99 : Math.max(e.absoluteY - startY.get(), tugMax.get()));
        return;
      }
      const target = settleTarget(Math.min(t.get(), 1), vy, D);
      const v = -vy / D;
      if (target === 1) {
        openW(c, key, v, false);
        scheduleOnRN(onOpening, key);
      } else closeW(c, key, v, false);
    },
    onFinalize: (e) => {
      if (c.held.get() === key) c.held.set(null);
      if (active.get()) {
        active.set(false);
        scheduleOnRN(onGrab, key, false);
        const pulled = tugged0.get();
        if (pulled >= 0) {
          tugged0.set(-1);
          if (Math.max(pulled, e.absoluteY - startY.get()) >= 10) {
            openW(c, key, 0, true);
            scheduleOnRN(onOpening, key);
          } else closeW(c, key, 0, true);
        }
        return;
      }
      // Never activated: a tap (less than 6 pt), or a press something else took over (a long one: ignore).
      const moved = Math.hypot(e.absoluteX - startX.get(), e.absoluteY - startY.get());
      if (moved >= TAP.maxMove || Date.now() - startMs.get() > 1000) {
        // Caught mid-settle and let go: carry on to the nearer end.
        const now = t.get();
        if (now > 0.04 && now < 0.999) {
          if (c.open.get() === key) openW(c, key, 0, true);
          else closeW(c, key, 0, true);
        }
        return;
      }
      const opening = c.open.get() !== key;
      toggleW(c, key);
      if (opening) scheduleOnRN(onOpening, key);
    },
  });

  // Web: a closed front eases out a hair under the mouse (its own `peek`: t, the camera and the drawer on
  // show stay put), and back when it leaves. Enabled whenever the pan is, even under Reduce Motion (where it
  // does nothing): RNGH web gives a disabled handler's view `touch-action: auto`, and that would hand a
  // touch drag on the front to the browser (pointercancel).
  const peek = c.peek[key];
  const hover = useHoverGesture({
    enabled: enabled && Platform.OS === 'web',
    onBegin: () => {
      if (rm) return;
      if (c.open.get() === null && t.get() < 0.01) peek.set(withTiming(1, { duration: 160 }));
    },
    onFinalize: () => {
      if (peek.get() > 0) peek.set(withTiming(0, { duration: 160 }));
    },
  });

  return useSimultaneousGestures(pan, hover);
}

/** `knock` when a drawer meets its stop (once per opening), `shut` when it's pushed home after being open. */
function useFeel(t: SharedValue<number>, on: boolean) {
  const knocked = useSharedValue(false);
  const wasOpen = useSharedValue(false);
  useAnimatedReaction(
    () => t.get(),
    (now, prev) => {
      if (!on || prev === null) return;
      if (now > 0.3) wasOpen.set(true);
      if (now < 0.5) knocked.set(false);
      if (prev < 0.98 && now >= 0.98 && !knocked.get()) {
        knocked.set(true);
        scheduleOnRN(feel.knock);
      }
      if (prev > 0.02 && now <= 0.02 && wasOpen.get()) {
        wasOpen.set(false);
        scheduleOnRN(feel.shut);
      }
    },
  );
}

export function useDrawers({ layout, rm, enabled, fixed, onOpening }: Options): Drawers {
  const frozenAt = (k: DrawerKey) => (fixed?.drawer === k ? Math.max(0, Math.min(1, fixed.t ?? 1)) : 0);
  const tPaper = useSharedValue(frozenAt('paper'));
  const tPens = useSharedValue(frozenAt('pens'));
  const tEnvelopes = useSharedValue(frozenAt('envelopes'));
  const tugPaper = useSharedValue(0);
  const tugPens = useSharedValue(0);
  const tugEnvelopes = useSharedValue(0);
  const peekPaper = useSharedValue(0);
  const peekPens = useSharedValue(0);
  const peekEnvelopes = useSharedValue(0);
  const initialOpen = fixed?.drawer && (fixed.t ?? 1) > 0.5 ? fixed.drawer : null;
  const open = useSharedValue<DrawerKey | null>(initialOpen);
  const held = useSharedValue<DrawerKey | null>(null);
  const t = { paper: tPaper, pens: tPens, envelopes: tEnvelopes };
  const tug = { paper: tugPaper, pens: tugPens, envelopes: tugEnvelopes };
  const peek = { paper: peekPaper, pens: peekPens, envelopes: peekEnvelopes };
  const c: Ctx = { t, tug, peek, open, held, rm };

  // A QA frame follows its params.
  const fixedDrawer = fixed?.drawer;
  const fixedT = fixed?.t;
  useEffect(() => {
    if (!fixedDrawer) return;
    const at = Math.max(0, Math.min(1, fixedT ?? 1));
    tPaper.set(fixedDrawer === 'paper' ? at : 0);
    tPens.set(fixedDrawer === 'pens' ? at : 0);
    tEnvelopes.set(fixedDrawer === 'envelopes' ? at : 0);
    open.set(at > 0.5 ? fixedDrawer : null);
  }, [fixedDrawer, fixedT, tPaper, tPens, tEnvelopes, open]);

  // The camera pan: the furthest-out drawer's t · C. The overshoot past 1 shows only up to the rubber band.
  const C = { paper: layout.drawers.paper.pan, pens: layout.drawers.pens.pan, envelopes: layout.drawers.envelopes.pan };
  const capP = 1 + 6 / layout.drawers.paper.travel;
  const capPe = 1 + 6 / layout.drawers.pens.travel;
  const capE = 1 + 6 / layout.drawers.envelopes.travel;
  const lift = useDerivedValue(() => {
    if (rm) return 0;
    return Math.max(
      Math.min(tPaper.get(), capP) * C.paper,
      Math.min(tPens.get(), capPe) * C.pens,
      Math.min(tEnvelopes.get(), capE) * C.envelopes,
      0,
    );
  });

  const [openKey, setOpenKey] = useState<DrawerKey | null>(initialOpen);
  const [shown, setShown] = useState<DrawerKey | null>(fixed?.drawer && (fixed.t ?? 1) > 0 ? fixed.drawer : null);
  const [dragging, setDragging] = useState<DrawerKey | null>(null);
  useAnimatedReaction(
    () => open.get(),
    (now, prev) => {
      if (now !== prev) scheduleOnRN(setOpenKey, now);
    },
  );
  // The drawer on show: the one furthest out (a closing one stays on show until it is home).
  useAnimatedReaction(
    () => {
      const a = tPaper.get() * C.paper;
      const b = tPens.get() * C.pens;
      const e = tEnvelopes.get() * C.envelopes;
      const tug0 = tugPaper.get() + tugPens.get() + tugEnvelopes.get();
      const m = Math.max(a, b, e);
      if (m <= 0.01 && tug0 === 0) return null;
      if (m <= 0.01) return tugPaper.get() > 0 ? 'paper' : tugPens.get() > 0 ? 'pens' : 'envelopes';
      return m === a ? 'paper' : m === b ? 'pens' : 'envelopes';
    },
    (now, prev) => {
      if (now !== prev) scheduleOnRN(setShown, now as DrawerKey | null);
    },
  );

  const haptics = !fixed?.drawer;
  useFeel(tPaper, haptics);
  useFeel(tPens, haptics);
  useFeel(tEnvelopes, haptics);

  // Typing can't go on under an open drawer: the keyboard goes (native), the caret leaves the sheet (web).
  const dismiss = () => {
    if (Platform.OS === 'web') (globalThis.document?.activeElement as HTMLElement | null)?.blur?.();
    else Keyboard.dismiss();
  };
  const opening = (key: DrawerKey) => {
    dismiss();
    onOpening?.(key);
  };
  const grab = (key: DrawerKey, on: boolean) => {
    // Only the web cursor needs to know (grab → grabbing): no render on a phone mid-gesture.
    if (Platform.OS === 'web') setDragging(on ? key : null);
    if (on) dismiss();
  };

  const gPaper = useFront('paper', c, layout.drawers.paper.travel, enabled, grab, opening);
  const gPens = useFront('pens', c, layout.drawers.pens.travel, enabled, grab, opening);
  const gEnvelopes = useFront('envelopes', c, layout.drawers.envelopes.travel, enabled, grab, opening);

  const openDrawer = (key: DrawerKey) => {
    opening(key);
    openW(c, key, 0, true);
  };
  const closeAll = (instant = false) => {
    open.set(null);
    for (const k of DRAWERS) {
      cancelAnimation(t[k]);
      if (instant) t[k].set(0);
      else if (t[k].get() > 0) settle(t[k], 0, 0, true, rm);
    }
  };
  const toggle = (key: DrawerKey) => (open.get() === key ? closeW(c, key, 0, true) : openDrawer(key));
  const breathe = () => {
    if (rm || open.get() !== null || tPaper.get() > 0) return;
    tPaper.set(withSequence(withTiming(0.06, { duration: 260 }), withTiming(0, { duration: 260 })));
  };

  return {
    t,
    tug,
    peek,
    open,
    held,
    lift,
    openKey,
    shown,
    dragging,
    gestures: { paper: gPaper, pens: gPens, envelopes: gEnvelopes },
    openDrawer,
    closeAll,
    toggle,
    breathe,
  };
}
