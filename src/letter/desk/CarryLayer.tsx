import { Skia } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState, type ComponentRef, type Ref } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, PointerType, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { feel } from '../../lib/haptics';
import { itemPicture } from './deskPictures';
import { StaticLayer } from './StaticLayer';
import { ITEM_MM } from './layout';
import { CARRY, TAP } from './motion';
import {
  deskItem,
  PENS,
  type CarryLayerProps,
  type CarryState,
  type DeskItem,
  type DeskItemId,
  type PickOutcome,
  type Rect,
} from './types';

/**
 * Taking things out of an open drawer (spec §3.5): each item's pan and tap, the lift, the carry (56 pt above
 * a finger, at the grab offset under a mouse), the drop line (the drawer's desk edge), the flight to where
 * the item goes, the refusal wiggle and the spring home. One static canvas draws the item being carried or
 * flying, recorded at its destination scale (it starts scaled down, never upsampled); everything that moves
 * is a view transform on the UI thread.
 */

/** Where an item lies in its open drawer, on screen: its centre, its scale (pt per mm) and its turn (degrees). */
export type ItemHome = { x: number; y: number; k: number; rot: number };
/**
 * Where a taken item flies: its centre on screen, its scale (pt per mm) and turn (degrees) on landing.
 * `fade`: 'land' dissolves over 80 ms on landing (into the redrawn desk); 'early' crossfades on the way
 * (paper into the sheet, a pen toward it on a phone).
 */
export type ItemDest = { x: number; y: number; k: number; rot: number; fade: 'land' | 'early' };

/** The carried item's motion, beside the `CarryState` (phase, grab, touch). All on the UI thread. */
export type CarryMotion = {
  /** The pointer on screen. */
  px: SharedValue<number>;
  py: SharedValue<number>;
  /** The item's centre whenever it isn't riding the pointer (lift, flight, home). */
  x: SharedValue<number>;
  y: SharedValue<number>;
  /** Its scale now (pt per mm): far in the drawer, growing toward the desk. */
  k: SharedValue<number>;
  /** Its turn (degrees) and the tilt from the hand's sideways speed (degrees). */
  rot: SharedValue<number>;
  tilt: SharedValue<number>;
  /** 0 lying in its slot → 1 carried: scale × 1.05, the shadow from tight to wide. */
  lift: SharedValue<number>;
  /** 0 → 1: a finger's 56 pt offset easing in over 80 ms. */
  ride: SharedValue<number>;
  opacity: SharedValue<number>;
};

const IDLE: CarryState = { phase: 'idle', x: 0, y: 0, grabX: 0, grabY: 0, vx: 0, vy: 0, touch: false };

/** An item's real size (mm), as the drawer and the recorders draw it. */
export function itemMm(item: DeskItem): { w: number; h: number } {
  switch (item.kind) {
    case 'paper':
      return ITEM_MM.stack;
    case 'envelope':
      return ITEM_MM.envelope;
    case 'ink':
      return { w: ITEM_MM.bottle, h: ITEM_MM.bottle };
    case 'pen':
      return { w: PENS[item.pen].lengthMm, h: ITEM_MM.penDiameter[item.pen] };
  }
}

/** A landing: damped, a hair of overshoot (the skill's 18–22 / 140–160 range, a little stiffer to keep it brisk). */
const FLY = { stiffness: 160, damping: 21, mass: 1 } as const;
const HOME = { stiffness: 190, damping: 24, mass: 1 } as const;
const QUICK = { duration: 150, reduceMotion: ReduceMotion.Never } as const;

type CarryOptions = {
  rm: boolean;
  /** Where an item lies in the open drawer, on screen. */
  homeOf: (item: DeskItem) => ItemHome | null;
  /** Where it goes once taken. */
  destOf: (item: DeskItem) => ItemDest;
  /** The screen's pick: decides, applies, shows the hint. */
  pick: (item: DeskItem, confirmed?: boolean) => PickOutcome;
  /** A taken item has landed. */
  onLanded?: (item: DeskItem) => void;
};

export type Carry = {
  carry: SharedValue<CarryState>;
  motion: CarryMotion;
  /** The item on the carry canvas (pressed, carried or flying), and its destination rect (sets the canvas scale). */
  item: DeskItem | null;
  destination: Rect | null;
  /** A pen or bottle carried out of its drawer: the drawer shows its groove or ring empty meanwhile. */
  hidden: DeskItem | null;
  /** For the item hits (UI → JS). */
  carryStart: (id: DeskItemId) => void;
  drop: (id: DeskItemId, vx: number, vy: number, above: boolean) => void;
  /** Take from rest: a tap, a button, a confirmation («Взять»). */
  take: (id: DeskItemId, confirmed?: boolean) => void;
};

/** The carry's state and the JS side of a take: decide (the screen's pick), then fly, wiggle or go home. */
export function useCarry({ rm, homeOf, destOf, pick, onLanded }: CarryOptions): Carry {
  const carry = useSharedValue<CarryState>(IDLE);
  const motion: CarryMotion = {
    px: useSharedValue(0),
    py: useSharedValue(0),
    x: useSharedValue(0),
    y: useSharedValue(0),
    k: useSharedValue(1),
    rot: useSharedValue(0),
    tilt: useSharedValue(0),
    lift: useSharedValue(0),
    ride: useSharedValue(0),
    opacity: useSharedValue(0),
  };
  const { x, y, k, rot, tilt, lift, ride, opacity } = motion;
  const [item, setItem] = useState<DeskItem | null>(null);
  const [destination, setDestination] = useState<Rect | null>(null);
  const [hidden, setHidden] = useState<DeskItem | null>(null);

  // Gesture callbacks were made in an earlier render: they reach this render's screen through refs.
  const latest = useRef({ homeOf, destOf, pick, onLanded, rm });
  useEffect(() => {
    latest.current = { homeOf, destOf, pick, onLanded, rm };
  });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));

  const destRect = (it: DeskItem): Rect => {
    const d = latest.current.destOf(it);
    const h = latest.current.homeOf(it);
    const mm = itemMm(it);
    // Never upsample: at least the carried size (the drawer's scale, lifted).
    const s = Math.max(d.k, (h?.k ?? d.k) * 1.06);
    return { x: d.x - (mm.w * s) / 2, y: d.y - (mm.h * s) / 2, width: mm.w * s, height: mm.h * s };
  };

  const show = (it: DeskItem) => {
    setItem((prev) => (prev?.id === it.id ? prev : it));
    setDestination(destRect(it));
  };

  const cleared = () => {
    carry.set(IDLE);
    opacity.set(0);
    setItem(null);
    setHidden(null);
  };

  // The item now flying (its landing callback runs on the UI thread, then here).
  const flying = useRef<DeskItemId | null>(null);
  const landed = () => {
    feel.tick();
    opacity.set(
      withTiming(0, { duration: 80, reduceMotion: ReduceMotion.Never }, (done) => {
        'worklet';
        if (done) scheduleOnRN(cleared);
      }),
    );
    const it = deskItem(flying.current ?? undefined);
    flying.current = null;
    if (it) latest.current.onLanded?.(it);
  };

  const fly = (it: DeskItem, vx: number, vy: number) => {
    const d = latest.current.destOf(it);
    flying.current = it.id;
    carry.set({ ...carry.get(), phase: 'fly', vx, vy });
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(landed);
    };
    if (latest.current.rm) {
      x.set(withTiming(d.x, QUICK));
      y.set(withTiming(d.y, QUICK, done));
      k.set(withTiming(d.k, QUICK));
      rot.set(withTiming(d.rot, QUICK));
      tilt.set(0);
    } else {
      x.set(withSpring(d.x, { ...FLY, velocity: vx }));
      y.set(withSpring(d.y, { ...FLY, velocity: vy, energyThreshold: 0.02 }, done));
      k.set(withSpring(d.k, FLY));
      rot.set(withSpring(d.rot, FLY));
      tilt.set(withSpring(0, FLY));
    }
    // Paper crossfades into the sheet before it reaches full size.
    if (d.fade === 'early')
      opacity.set(withDelay(latest.current.rm ? 0 : 140, withTiming(0, { duration: 220, reduceMotion: ReduceMotion.Never })));
  };

  const homed = () => {
    setHidden(null);
    // The drawer redraws with the item back in its slot: keep the carried copy over it for a moment.
    later(cleared, 140);
  };

  const goHome = (it: DeskItem, wiggle: boolean) => {
    const h = latest.current.homeOf(it);
    if (!h) return cleared();
    const back = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(homed);
    };
    const reduce = latest.current.rm;
    carry.set({ ...carry.get(), phase: wiggle && !reduce ? 'wiggle' : 'home' });
    tilt.set(reduce ? 0 : withSpring(0, HOME));
    if (reduce) {
      x.set(withTiming(h.x, QUICK));
      y.set(withTiming(h.y, QUICK, back));
      k.set(withTiming(h.k, QUICK));
      rot.set(withTiming(h.rot, QUICK));
      lift.set(withTiming(0, QUICK));
      return;
    }
    // A refusal: wiggle ±3°, two cycles in 240 ms, where it was dropped (or in its slot), then home.
    const wait = wiggle ? 240 : 0;
    if (wiggle) {
      const r0 = rot.get();
      const w = (to: number, duration: number) => withTiming(to, { duration, easing: Easing.inOut(Easing.sin) });
      rot.set(withSequence(w(r0 + 3, 40), w(r0 - 3, 60), w(r0 + 3, 60), w(r0 - 3, 50), w(r0, 30), withSpring(h.rot, HOME)));
    } else rot.set(withSpring(h.rot, HOME));
    x.set(withDelay(wait, withSpring(h.x, HOME)));
    y.set(withDelay(wait, withSpring(h.y, { ...HOME, energyThreshold: 0.02 }, back)));
    k.set(withDelay(wait, withSpring(h.k, HOME)));
    lift.set(withDelay(wait, withTiming(0, { duration: 160 })));
  };

  const decide = (it: DeskItem, vx: number, vy: number, confirmed: boolean) => {
    const out = latest.current.pick(it, confirmed);
    if (out.kind === 'apply') fly(it, vx, vy);
    else goHome(it, out.kind === 'refuse');
  };

  const carryStart = (id: DeskItemId) => {
    const it = deskItem(id);
    if (!it) return;
    feel.lift();
    show(it);
    // A pen or a bottle is the only one of its kind: its groove or place empties while it is carried.
    if (it.kind === 'pen' || it.kind === 'ink') setHidden(it);
  };
  const drop = (id: DeskItemId, vx: number, vy: number, above: boolean) => {
    const it = deskItem(id);
    if (!it) return cleared();
    if (!above) return goHome(it, false);
    decide(it, vx, vy, false);
  };
  const take = (id: DeskItemId, confirmed = false) => {
    const it = deskItem(id);
    const h = it && latest.current.homeOf(it);
    if (!it || !h) return;
    const phase = carry.get().phase;
    if (phase !== 'idle' && phase !== 'home') return;
    feel.lift();
    show(it);
    cancelAnimation(x);
    cancelAnimation(y);
    x.set(h.x);
    y.set(h.y);
    k.set(h.k);
    rot.set(h.rot);
    tilt.set(0);
    ride.set(0);
    opacity.set(1);
    lift.set(withTiming(1, { duration: 120, reduceMotion: ReduceMotion.Never }));
    carry.set({ ...IDLE, phase: 'lift', x: h.x, y: h.y });
    decide(it, 0, 0, confirmed);
  };

  return { carry, motion, item, destination, hidden, carryStart, drop, take };
}

type ItemHitProps = {
  item: DeskItem;
  /** The touch target, in the box's own coordinates. */
  hit: Rect;
  /** Where the item lies on screen while its drawer is open. */
  home: ItemHome;
  /** Items dropped above this y (the open drawer's desk edge on screen) are taken. */
  dropY: number;
  enabled: boolean;
  /** In use (in hand, on the desk): `selected` for a screen reader; a pen or bottle in use isn't in the drawer. */
  inUse: boolean;
  label: string;
  rm: boolean;
  carry: Carry;
  /** The first item of a drawer takes the screen reader's focus when it opens. */
  focusRef?: Ref<ComponentRef<typeof View>>;
};

/**
 * One item's touch target in an open drawer: a pan from the first touch (minDistance 0). A tap (< 8 pt,
 * < 250 ms) takes it; 8 pt of movement lifts and carries it. A Pressable under it is the button a screen
 * reader or a keyboard uses.
 */
export function ItemHit({ item, hit, home, dropY, enabled, inUse, label, rm, carry: c, focusRef }: ItemHitProps) {
  const { carry, motion } = c;
  const { px, py, x, y, k, rot, tilt, lift, ride, opacity } = motion;
  const { carryStart, drop, take } = c;
  const id = item.id;
  // A pen or a bottle in use lies on the desk, not here: nothing to take.
  const takeable = !(inUse && (item.kind === 'pen' || item.kind === 'ink'));
  const downX = useSharedValue(0);
  const downY = useSharedValue(0);
  const downMs = useSharedValue(0);
  const carrying = useSharedValue(false);
  const ignored = useSharedValue(true);
  const vx = useSharedValue(0);
  const vy = useSharedValue(0);
  const lastMs = useSharedValue(0);

  const pan = usePanGesture({
    enabled: enabled && takeable,
    minDistance: 0,
    onBegin: (e) => {
      if (carry.get().phase !== 'idle') {
        ignored.set(true);
        return;
      }
      ignored.set(false);
      carrying.set(false);
      vx.set(0);
      vy.set(0);
      downX.set(e.absoluteX);
      downY.set(e.absoluteY);
      downMs.set(Date.now());
      lastMs.set(Date.now());
      px.set(e.absoluteX);
      py.set(e.absoluteY);
      // The carry canvas is made when the item lifts (or is taken), not on touch-down: on web its first
      // draw takes the main thread, and a tap's release must not wait behind it.
    },
    onUpdate: (e) => {
      if (ignored.get()) return;
      if (!carrying.get()) {
        if (Math.hypot(e.absoluteX - downX.get(), e.absoluteY - downY.get()) < CARRY.activate) return;
        carrying.set(true);
        const touch = e.pointerType === PointerType.TOUCH;
        carry.set({
          phase: 'carry',
          x: home.x,
          y: home.y,
          grabX: home.x - e.absoluteX,
          grabY: home.y - e.absoluteY,
          vx: 0,
          vy: 0,
          touch,
        });
        x.set(home.x);
        y.set(home.y);
        k.set(home.k);
        rot.set(home.rot);
        tilt.set(0);
        opacity.set(1);
        lift.set(withTiming(1, { duration: 120, reduceMotion: ReduceMotion.Never }));
        ride.set(0);
        if (touch) ride.set(withTiming(1, { duration: 80, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.Never }));
        scheduleOnRN(carryStart, id);
      }
      // Release velocity: the event's, or the finger's own (web touch events report none).
      const now = Date.now();
      const dt = now - lastMs.get();
      if (e.velocityX !== 0 || e.velocityY !== 0) {
        vx.set(e.velocityX);
        vy.set(e.velocityY);
      } else if (dt > 0) {
        vx.set(0.5 * vx.get() + (0.5 * (e.absoluteX - px.get()) * 1000) / dt);
        vy.set(0.5 * vy.get() + (0.5 * (e.absoluteY - py.get()) * 1000) / dt);
      }
      lastMs.set(now);
      px.set(e.absoluteX);
      py.set(e.absoluteY);
      // The hand's sideways speed tips the item a little (none under Reduce Motion).
      if (!rm) tilt.set(withSpring(Math.max(-4, Math.min(4, vx.get() / 250)), { stiffness: 220, damping: 22 }));
    },
    onFinalize: (e) => {
      if (ignored.get()) return;
      ignored.set(true);
      if (carrying.get()) {
        carrying.set(false);
        const s = carry.get();
        const r = ride.get();
        cancelAnimation(ride);
        const cx = px.get() + s.grabX * (1 - r);
        const cy = py.get() + s.grabY * (1 - r) + (s.touch ? CARRY.offset * r : 0);
        x.set(cx);
        y.set(cy);
        carry.set({ ...s, phase: 'home', x: cx, y: cy, vx: vx.get(), vy: vy.get() });
        // Never commit a cancelled gesture: it goes back to its slot.
        const still = Date.now() - lastMs.get() > 90;
        scheduleOnRN(drop, id, still ? 0 : vx.get(), still ? 0 : vy.get(), !e.canceled && cy < dropY);
        return;
      }
      const moved = Math.hypot(e.absoluteX - downX.get(), e.absoluteY - downY.get());
      if (moved < CARRY.activate && Date.now() - downMs.get() < TAP.maxMs) scheduleOnRN(take, id, false);
    },
  });

  const style = { left: hit.x, top: hit.y, width: hit.width, height: hit.height };
  return (
    <View style={[styles.hit, style]}>
      <Pressable
        ref={focusRef}
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: inUse, disabled: !takeable }}
        disabled={!enabled || !takeable}
        onPress={() => take(id)}
      />
      <GestureDetector gesture={pan} touchAction="none">
        <View
          style={[StyleSheet.absoluteFill, Platform.OS === 'web' && takeable && enabled ? styles.grab : null]}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        />
      </GestureDetector>
    </View>
  );
}

/**
 * The item being carried or flying, on its own static canvas over everything. It is recorded once, at its
 * destination's scale (`destination`'s width over the item's size), and shown scaled down to the drawer's
 * scale, so it only ever shrinks. Two shadows under it crossfade as it lifts: tight while it lies (dy 2,
 * blur 3, 35 %), wide once carried (dy 12, blur 20, 25 %), toward the bottom right.
 */
export function CarryLayer({ layout, seed, carry, item, destination, motion }: CarryLayerProps & { motion: CarryMotion }) {
  const { px, py, x, y, k, rot, tilt, lift, ride, opacity } = motion;
  const mm = item ? itemMm(item) : { w: 1, h: 1 };
  const S = destination && item ? destination.width / mm.w : layout.far;
  const w = mm.w * S;
  const h = mm.h * S;
  const pad = Math.round(Math.max(12, 0.12 * Math.max(w, h)));
  const cw = w + 2 * pad;
  const ch = h + 2 * pad;
  const picture = useMemo(() => (item ? itemPicture(item, S, seed) : null), [item, S, seed]);
  // The item inside its padding (room for anything drawn past its edges), as one static layer.
  const padded = () => {
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, cw, ch));
    canvas.translate(pad, pad);
    if (picture) canvas.drawPicture(picture);
    return recorder.finishRecordingAsPicture();
  };
  // Shadows are drawn in canvas units, then scaled with the item: size them for the carried scale.
  const u = S / (layout.far * 1.05);

  const style = useAnimatedStyle(() => {
    const s = carry.get();
    const r = ride.get();
    const riding = s.phase === 'carry';
    const cx = riding ? px.get() + s.grabX * (1 - r) : x.get();
    const cy = riding ? py.get() + s.grabY * (1 - r) + (s.touch ? CARRY.offset * r : 0) : y.get();
    const scale = (k.get() / S) * (1 + 0.05 * lift.get());
    return {
      opacity: s.phase === 'idle' ? 0 : opacity.get(),
      transform: [
        { translateX: cx - cw / 2 },
        { translateY: cy - ch / 2 },
        { rotate: `${rot.get() + tilt.get()}deg` },
        { scale },
      ],
    };
  });
  const tight = useAnimatedStyle(() => ({ opacity: 1 - lift.get() }));
  const wide = useAnimatedStyle(() => ({ opacity: lift.get() }));
  if (!item || !picture) return null;

  const box = { left: pad, top: pad, width: w, height: h, borderRadius: Math.min(w, h) * 0.04 };
  const shadow = (dy: number, blur: number, a: number) =>
    `${(dy * 0.6 * u).toFixed(1)}px ${(dy * u).toFixed(1)}px ${(blur * u).toFixed(1)}px rgba(20, 12, 6, ${a})`;
  return (
    <Animated.View pointerEvents="none" style={[styles.carry, { width: cw, height: ch }, style]}>
      <Animated.View style={[styles.shadow, box, { boxShadow: shadow(2, 3, 0.35) }, tight]} />
      <Animated.View style={[styles.shadow, box, { boxShadow: shadow(12, 20, 0.25) }, wide]} />
      <StaticLayer cacheKey={`carry:${item.id}:${S.toFixed(3)}:${seed}:${pad}`} width={cw} height={ch} record={padded} style={styles.fill} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hit: { position: 'absolute' },
  grab: { cursor: 'grab' } as object,
  carry: { position: 'absolute', left: 0, top: 0 },
  shadow: { position: 'absolute' },
  fill: { position: 'absolute', left: 0, top: 0 },
});
