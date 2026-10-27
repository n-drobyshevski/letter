import { Canvas, LinearGradient, Rect as SkRect, vec } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type DerivedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { useLabParams } from '../../lib/params';
import { useMotionPrefs } from '../../lib/useMotionPrefs';
import { DESK, type Country } from '../../theme/stationery';
import { looseAreaOf } from '../stack';
import type { Lang } from '../tracking/copy';
import { Nosing, ApronCanvas } from './ApronCanvas';
import { CarryLayer, ItemHit, itemMm, useCarry, type Carry, type ItemDest, type ItemHome } from './CarryLayer';
import { DESK_COPY } from './deskCopy';
import { EDGE_SHADOW } from './deskPictures';
import { DrawerBox, EdgeShadow } from './DrawerBox';
import { DRAWER_WALL, restingPlaces } from './layout';
import { drawerSlots } from './slots';
import { Underlay } from './Underlay';
import {
  DRAWERS,
  deskItem,
  inUseOf,
  type DeskItem,
  type DeskItemId,
  type DeskLayout,
  type DeskSceneProps,
  type DrawerKey,
  type HintKey,
  type InUse,
  type PickOutcome,
  type Rect,
  type Slot,
} from './types';
import { useDrawers, type Drawers } from './useDrawers';

/**
 * The writing screens' desk (spec §2, §3): the scroll view with the desk top under the sheet, and a fixed
 * band at the bottom of the screen with the apron and three drawers (paper, pens and inks, envelopes).
 * Pull a front up (or tap it, or tug it down) and the camera pans up while the drawer comes out; take an
 * item with a tap or carry it up onto the desk. Everything that moves is a view transform driven on the UI
 * thread; the canvases (desk top, apron, drawer boxes, the carried item) are static and redraw only when
 * what they show changes, never per frame or per keystroke.
 *
 * Z-order, back to front: floor, apron, drawer boxes, scroll view, nosing, tap-catcher, fronts, carry, hint.
 * Under Reduce Motion nothing pans: the open drawer crossfades in as a panel over the dimmed scene.
 */

// Once per app session: the paper drawer breathes on the first blank visit, and the hint says how to open a drawer.
let breathed = false;
let everOpened = false;

const HINT_MS = 3500;
/** How far (pt) a hovered front eases out (web). */
const PEEK = 3;
/** Web: how far (pt) above the desk's near edge the scrolling column fades out. */
const FADE = 14;
/** The Reduce Motion «Задвинуть ящик» link's width (pt). */
const CLOSE_W = 160;
const HINT_COLOR = '#d4c4a8';
const deg = (rad: number) => (rad * 180) / Math.PI;

type Hint = { key: HintKey; confirm?: DeskItemId; n: number };
/** What the paper and envelope boxes are drawn with (they draw nothing differently for what is in use). */
const NO_USE: InUse = inUseOf({ paper: 'grid', ink: 'blueBlack', font: 'badScript' }, { paper: 'cream', liner: 'postal' });
type ViewRef = ComponentRef<typeof View>;

export function DeskScene({
  lang,
  country,
  seed,
  layout,
  title,
  hint,
  header,
  sheet,
  children,
  look,
  envelope,
  locked,
  editing,
  busy,
  onPick,
  fixed,
}: DeskSceneProps) {
  const copy = DESK_COPY[lang];
  const preset = country;
  const prefs = useMotionPrefs();
  const rm = !!fixed?.rm || prefs.reduceMotion;
  const needsButtons = prefs.needsButtons || !!fixed?.rm;
  const native = Platform.OS !== 'web';
  // The keyboard is up (native): the band slides away. A laptop's keyboard needs no room.
  const typing = (native && editing) || !!fixed?.kb;
  const frozen = fixed?.drawer !== undefined;
  const qa = !!fixed && Object.values(fixed).some((v) => v !== undefined);
  const debug = !!useLabParams().debug;
  const { band, fronts, insets, width: W, height: H } = layout;
  const frontY = fronts.paper.y;

  // ------------------------------------------------------------------ hints
  const blank = !locked.paper && !locked.pen && !locked.ink;
  const [hintNow, setHint] = useState<Hint | null>(() =>
    !breathed && !everOpened && blank && !qa ? { key: 'firstPull', n: 0 } : null,
  );
  const showHint = (key: HintKey, confirm?: DeskItemId) => setHint((h) => ({ key, confirm, n: (h?.n ?? 0) + 1 }));
  useEffect(() => {
    if (!hintNow || hintNow.confirm) return;
    const n = hintNow.n;
    const id = setTimeout(() => setHint((h) => (h?.n === n ? null : h)), HINT_MS);
    return () => clearTimeout(id);
  }, [hintNow]);

  // ------------------------------------------------------------------ the scroll view and the sheet
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const contentRef = useRef<ViewRef>(null);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.set(e.contentOffset.y);
  });
  const [sheetRect, setSheetRect] = useState<Rect | null>(null);
  const [contentH, setContentH] = useState(0);
  const onSheetLayout = (e: LayoutChangeEvent) => {
    const l = e.nativeEvent.layout;
    // On the loose desk the slot is the whole loose area, the sheet's home at its middle.
    const drop = layout.loose ? (looseAreaOf(layout.sheet.width, layout.sheet.height, layout.width).height - layout.sheet.height) / 2 : 0;
    const r = {
      x: Math.round(l.x + (l.width - layout.sheet.width) / 2),
      y: Math.round(l.y + drop),
      width: layout.sheet.width,
      height: layout.sheet.height,
    };
    setSheetRect((p) => (p && p.x === r.x && p.y === r.y && p.width === r.width && p.height === r.height ? p : r));
  };

  // ------------------------------------------------------------------ drawers
  const firstItem = useRef<Record<DrawerKey, ViewRef | null>>({ paper: null, pens: null, envelopes: null });
  const frontRef = useRef<Record<DrawerKey, ViewRef | null>>({ paper: null, pens: null, envelopes: null });
  const byKeyboard = useRef(false);
  /** The drawer the keyboard opened (web): focus goes back to its front when it closes. */
  const keyboardOpened = useRef<DrawerKey | null>(null);
  const onOpening = (key: DrawerKey) => {
    everOpened = true;
    showHint(`opened.${key}`);
    keyboardOpened.current = !native && byKeyboard.current ? key : null;
    // Scrolled down far enough (a small phone) that the camera's pan would take the whole sheet off the
    // top: scroll back so its foot sits at the open drawer's desk edge, and what is taken lands on it.
    if (!rm && sheetRect) {
      const sy = scrollY.get();
      const foot = sheetRect.y + sheetRect.height;
      if (foot - sy - layout.drawers[key].pan < insets.top + 120) {
        const y = Math.max(0, Math.min(sy, foot - band.top));
        if (y < sy)
          scheduleOnUI(() => {
            'worklet';
            scrollTo(scrollRef, 0, y, true);
          });
      }
    }
    if (native && prefs.screenReader) {
      if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(copy.opened(key));
      setTimeout(() => {
        const el = firstItem.current[key];
        if (el) AccessibilityInfo.sendAccessibilityEvent(el, 'focus');
      }, 400);
    } else if (!native && byKeyboard.current) {
      // Enter or Space on a front: the keyboard goes on to the drawer's first item.
      setTimeout(() => (firstItem.current[key] as unknown as HTMLElement | null)?.focus?.(), 400);
    }
    byKeyboard.current = false;
  };
  const drawers = useDrawers({
    layout,
    rm,
    enabled: !frozen && !busy && !typing,
    fixed: frozen ? { drawer: fixed?.drawer, t: fixed?.t } : undefined,
    onOpening,
  });
  const { t, tug, lift, openKey, shown } = drawers;

  // First visit (blank letter, once per session, no QA frame): the paper drawer breathes after 1.5 s.
  const breathe = drawers.breathe;
  useEffect(() => {
    if (breathed || everOpened || qa || !blank || rm) return;
    const id = setTimeout(() => {
      breathed = true;
      breathe();
    }, 1500);
    return () => clearTimeout(id);
  }, [qa, blank, rm, breathe]);

  // Keyboard up (native): the band slides down out of the way and any open drawer closes.
  const bandY = useSharedValue(typing ? band.height : 0);
  const closeAll = drawers.closeAll;
  useEffect(() => {
    bandY.set(withTiming(typing ? band.height : 0, { duration: 220, easing: Easing.out(Easing.cubic) }));
    if (typing && !frozen) closeAll(rm);
  }, [typing, band.height, bandY, frozen, closeAll, rm]);

  // Drawer boxes mount once the screen has settled (so the first opening never waits for them), or when used.
  // (React Native 0.88 has no InteractionManager: two frames, then 500 ms.)
  const [mountAll, setMountAll] = useState(false);
  useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      id = setTimeout(() => setMountAll(true), 500);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (id) clearTimeout(id);
    };
  }, []);
  const mounted = (d: DrawerKey) => mountAll || shown === d || openKey === d || fixed?.drawer === d;

  // ------------------------------------------------------------------ the desk under an open drawer
  // The sealed-letter question belongs to the drawer it was asked from: it goes when that one closes or
  // another opens (it never outlives its drawer over the controls under the sheet).
  const [hintDrawer, setHintDrawer] = useState(openKey);
  if (hintDrawer !== openKey) {
    setHintDrawer(openKey);
    if (hintNow?.confirm && deskItem(hintNow.confirm)?.drawer !== openKey) setHint(null);
  }
  // While a drawer is open the sheet and its controls are out of reach: no keyboard focus, no screen
  // reader, no typing blind into the letter panned off screen (a tap only closes the drawer).
  const under = !!openKey && !frozen;
  useEffect(() => {
    const el = contentRef.current as unknown as HTMLElement | null;
    if (!native && el) el.inert = under;
  }, [under, native]);
  // Web, a drawer opened from the keyboard: when it closes (a pick, Escape, a click), focus goes back to its
  // front instead of falling to the page. Escape closes an open drawer.
  const wasOpen = useRef(openKey);
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = openKey;
    if (native || !was || was === openKey || keyboardOpened.current !== was) return;
    keyboardOpened.current = null;
    const id = setTimeout(() => {
      const doc = globalThis.document;
      if (!doc?.activeElement || doc.activeElement === doc.body)
        (frontRef.current[was] as unknown as HTMLElement | null)?.focus?.();
    }, 60);
    return () => clearTimeout(id);
  }, [openKey, native]);
  useEffect(() => {
    const doc = globalThis.document;
    if (native || !openKey || frozen || !doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      keyboardOpened.current = openKey;
      closeAll();
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [openKey, frozen, native, closeAll]);
  // Web: the column (title, sheet, controls) fades over its last 14 pt above the desk's near edge, so what
  // scrolls under the nosing slides under it instead of being sliced (the wood under it stays whole).
  const fadeAt = (y: number) => {
    const el = contentRef.current as unknown as HTMLElement | null;
    if (!el) return;
    const end = Math.round(band.top + y);
    const mask = `linear-gradient(to bottom, #000 ${end - FADE}px, transparent ${end}px)`;
    el.style.setProperty('mask-image', mask);
    el.style.setProperty('-webkit-mask-image', mask);
  };
  useAnimatedReaction(
    () => scrollY.get(),
    (y, prev) => {
      if (Platform.OS === 'web' && y !== prev) scheduleOnRN(fadeAt, y);
    },
  );
  useEffect(() => {
    if (!native) fadeAt(scrollY.get());
  });

  // ------------------------------------------------------------------ what is in use, and where things lie
  // Primitives only: a keystroke (a new `look` object with the same kinds) never redraws the desk.
  const { paper: lookPaper, ink: lookInk, font: lookFont } = look;
  const { paper: envPaper, liner: envLiner } = envelope;
  const inUse = useMemo(
    () => inUseOf({ paper: lookPaper, ink: lookInk, font: lookFont }, { paper: envPaper, liner: envLiner }),
    [lookPaper, lookInk, lookFont, envPaper, envLiner],
  );
  const slots = useMemo(
    () => ({
      paper: drawerSlots('paper', layout, inUse),
      pens: drawerSlots('pens', layout, inUse),
      envelopes: drawerSlots('envelopes', layout, inUse),
    }),
    [layout, inUse],
  );
  /** The top of a drawer's box on screen when it is open (also the line above which a carried item is taken). */
  const boxTop = (d: DrawerKey) => frontY - layout.drawers[d].travel - layout.drawers[d].depth;
  const homes = useMemo(() => {
    const out: Partial<Record<DeskItemId, ItemHome>> = {};
    for (const d of DRAWERS) {
      const top = layout.fronts.paper.y - layout.drawers[d].travel - layout.drawers[d].depth;
      for (const s of slots[d]) {
        out[s.item.id] = {
          x: layout.fronts[d].x + DRAWER_WALL + s.rect.x + s.rect.width / 2,
          y: top + s.rect.y + s.rect.height / 2,
          k: s.rect.width / itemMm(s.item).w,
          rot: deg(s.rotation),
        };
      }
    }
    return out;
  }, [slots, layout]);

  /** Where a taken item goes (§3.5): onto the sheet, to its resting place beside it, or away off the top right. */
  const destOf = (item: DeskItem): ItemDest => {
    const L = rm ? 0 : layout.drawers[item.drawer].pan;
    const sy = scrollY.get();
    const r = sheetRect ?? {
      x: (W - layout.sheet.width) / 2,
      y: insets.top + 120,
      width: layout.sheet.width,
      height: layout.sheet.height,
    };
    const sheetOn = { x: r.x, y: r.y - sy - L, width: r.width, height: r.height };
    // The part of the sheet still on screen above the open drawer; if hardly any of it is (scrolled far
    // down on a small phone), the strip of desk just above the drawer's edge.
    const edge = boxTop(item.drawer);
    let top = Math.max(sheetOn.y, insets.top);
    let bottom = Math.min(sheetOn.y + sheetOn.height, edge);
    if (bottom - top < 40) {
      bottom = edge - 8;
      top = Math.max(insets.top, bottom - 60);
    }
    const grow = Math.min(layout.near, 2 * layout.far);
    const places = sheetRect ? restingPlaces(layout, sheetRect) : null;
    const at = (p: { x: number; y: number; rotation: number; scale: number }): ItemDest => ({
      x: p.x,
      y: p.y - sy - L,
      k: p.scale,
      rot: deg(p.rotation),
      fade: 'land',
    });
    const away: ItemDest = { x: W + 70, y: insets.top - 70, k: 1.4 * layout.far, rot: 12, fade: 'land' };
    switch (item.kind) {
      case 'paper':
        return {
          x: sheetOn.x + sheetOn.width / 2,
          y: (top + bottom) / 2,
          k: layout.mode === 'laptop' ? sheetOn.width / itemMm(item).w : grow,
          rot: 0,
          fade: 'early',
        };
      case 'pen':
        if (places) return at(places.pen);
        return { x: sheetOn.x + sheetOn.width * 0.8, y: bottom - 30, k: grow, rot: -60, fade: 'early' };
      case 'ink':
        return places ? at(places.bottle) : away;
      case 'envelope':
        return places ? at(places.envelope) : away;
    }
  };

  const pick = (item: DeskItem, confirmed?: boolean): PickOutcome => {
    const out = onPick(item, confirmed);
    if (out.kind === 'confirm') showHint('sealedConfirm', item.id);
    else if (out.kind === 'refuse') showHint(out.hint);
    else if (out.hint) showHint(out.hint);
    return out;
  };
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const carry = useCarry({
    rm,
    homeOf: (item) => homes[item.id] ?? null,
    destOf,
    pick,
    // The drawer closes 300 ms after a landing; with buttons it stays open until closed.
    onLanded: () => {
      if (needsButtons) return;
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => drawers.closeAll(), 300);
    },
  });
  // Only the pen tray draws what is in use (an empty groove, an ink ring); the paper and envelope boxes
  // look the same whatever was taken (the tick is in their captions). So each box gets a value that changes
  // only with what it draws, and a pick never redraws the others (on web every redraw is a new WebGL
  // context with its shaders compiled again). A pen or bottle being carried leaves its place empty.
  const hidden = carry.hidden;
  const boxPen = hidden?.kind === 'pen' ? hidden.pen : inUse.pen;
  const boxInk = hidden?.kind === 'ink' ? hidden.ink : inUse.ink;
  const pensUse = useMemo<InUse>(() => ({ ...NO_USE, pen: boxPen, ink: boxInk }), [boxPen, boxInk]);
  const boxInUse = (d: DrawerKey): InUse => (d === 'pens' ? pensUse : NO_USE);

  const lockedItem = (item: DeskItem) =>
    (item.kind === 'paper' && locked.paper && item.paper !== look.paper) ||
    (item.kind === 'pen' && locked.pen && item.pen !== inUse.pen) ||
    (item.kind === 'ink' && locked.ink && item.ink !== look.ink);

  // ------------------------------------------------------------------ layers
  const scrollStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.get() }] }));
  const apronStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.get() + bandY.get() }] }));
  const catcherStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.get() }] }));
  // The laptop's resting items fade to 40 % while a drawer is open: its stock is never read against them.
  const restingStyle = useAnimatedStyle(() => {
    const m = Math.max(t.paper.get(), t.pens.get(), t.envelopes.get());
    return { opacity: 1 - 0.6 * Math.max(0, Math.min(1, (m - 0.3) / 0.3)) };
  });
  const tMax = useAnimatedStyle(() => ({
    opacity: 0.3 * Math.max(0, Math.min(1, Math.max(t.paper.get(), t.pens.get(), t.envelopes.get()))),
  }));

  // Their own stacking context: the box on show goes over its neighbours, never over the scroll view.
  const boxes = (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {DRAWERS.map((d) => (
        <DrawerLayer
          key={d}
          drawer={d}
          layout={layout}
          preset={preset}
          seed={seed}
          lang={lang}
          inUse={boxInUse(d)}
          slots={slots[d]}
          t={t[d]}
          tug={tug[d]}
          peek={drawers.peek[d]}
          lift={lift}
          bandY={bandY}
          rm={rm}
          mounted={mounted(d)}
          onTop={shown === d || openKey === d}
          interactive={openKey === d && !frozen}
          lifted={deskItem(fixed?.item)?.drawer === d ? fixed?.item : undefined}
          debug={debug}
          carry={carry}
          homes={homes}
          dropY={boxTop(d)}
          locked={lockedItem}
          focusRef={(el: ViewRef | null) => {
            firstItem.current[d] = el;
          }}
        />
      ))}
    </View>
  );

  const open = openKey;
  const openFrontBottom = open ? frontY + band.fronts - layout.drawers[open].travel : 0;

  return (
    <View style={[styles.root, { width: W, height: H }]}>
      <Floor width={W} height={H} />

      {/* The apron with its closed fronts. */}
      <Animated.View pointerEvents="none" style={[styles.abs, { top: band.top, width: W, height: band.height }, apronStyle]}>
        <Counted name="apron" on={debug}>
          <ApronCanvas layout={layout} preset={preset} seed={seed} lang={lang} />
        </Counted>
      </Animated.View>

      {!rm && boxes}

      <Animated.ScrollView
        ref={scrollRef}
        style={[styles.abs, styles.scroll, { top: 0, width: W, height: band.top }, scrollStyle]}
        contentContainerStyle={{ minHeight: band.top }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        scrollEnabled={!open}
        onContentSizeChange={(_, h) => setContentH(Math.round(h))}
      >
        <Counted name="underlay" on={debug}>
          <Underlay
            layout={layout}
            preset={preset}
            seed={seed}
            sheetRect={sheetRect}
            contentHeight={Math.max(contentH, band.top)}
            resting={layout.resting === 'sides' ? inUse : null}
            restingStyle={restingStyle}
          />
        </Counted>
        <View
          ref={contentRef}
          style={[styles.content, { paddingTop: insets.top + 12, minHeight: band.top }]}
          importantForAccessibility={under ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={under}
        >
          {title && <Text style={styles.title}>{title}</Text>}
          {hint && <Text style={[styles.hint, { maxWidth: layout.mode === 'laptop' ? 520 : 420 }]}>{hint}</Text>}
          {header}
          {/* The sous-main starts 4 pt under the header (title, hint, mode row): the sheet sits its margin below that. */}
          <View onLayout={onSheetLayout} style={[styles.sheet, { marginTop: Math.max(0, layout.pad.marginY + 4 - 12) }]}>
            {sheet}
          </View>
          {children}
        </View>
      </Animated.ScrollView>

      {/* The desk's near edge over an open drawer, and its shadow falling in while the drawer moves. */}
      <Animated.View pointerEvents="none" style={[styles.abs, { top: band.top, width: W, height: band.nosing }, apronStyle]}>
        <Nosing layout={layout} preset={preset} seed={seed} />
      </Animated.View>
      {!rm &&
        DRAWERS.map((d) => mounted(d) && <EdgeFall key={d} drawer={d} layout={layout} t={t[d]} lift={lift} bandY={bandY} />)}

      {/* While a drawer is open a tap on the desk only closes it (no ink, no caret, no turn). */}
      {open && !frozen && !rm && (
        <Animated.View style={[styles.abs, { top: 0, width: W, height: band.top }, catcherStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => drawers.closeAll()}
            accessible={false}
            focusable={false}
            tabIndex={-1}
          />
        </Animated.View>
      )}
      {rm && (
        <>
          {/* The open drawer is out of its opening: only the dark cavity is left in the apron (never two fronts). */}
          {DRAWERS.map((d) => (
            <Cavity key={d} drawer={d} layout={layout} t={t[d]} bandY={bandY} />
          ))}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, tMax]} />
          {open && !frozen && (
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => drawers.closeAll()}
              accessible={false}
              focusable={false}
              tabIndex={-1}
            />
          )}
          {boxes}
        </>
      )}

      {DRAWERS.map((d) => (
        <FrontHit
          key={d}
          drawer={d}
          layout={layout}
          drawers={drawers}
          bandY={bandY}
          rm={rm}
          hidden={typing}
          label={copy.a11yDrawer(d, openKey === d)}
          expanded={openKey === d}
          pressRef={(el: ViewRef | null) => {
            frontRef.current[d] = el;
          }}
          onPress={() => {
            byKeyboard.current = !native;
            drawers.toggle(d);
          }}
        />
      ))}

      <CarryLayer
        layout={layout}
        preset={preset}
        seed={seed}
        carry={carry.carry}
        item={carry.item}
        destination={carry.destination}
        motion={carry.motion}
      />

      <HintArea
        layout={layout}
        lang={lang}
        hint={
          hintNow &&
          (hintNow.confirm
            ? deskItem(hintNow.confirm)?.drawer === open
            : !hintNow.key.startsWith('opened.') || hintNow.key === `opened.${open}`)
            ? hintNow
            : null
        }
        open={open}
        rm={rm}
        frontBottom={openFrontBottom}
        panelTop={open ? boxTop(open) : 0}
        closeLink={needsButtons && !!open && !frozen}
        onClose={() => drawers.closeAll()}
        onTake={(id) => {
          setHint(null);
          carry.take(id, true);
        }}
        onKeep={() => setHint(null)}
        typing={typing}
      />

      {debug && <DebugCounts />}
    </View>
  );
}

// ------------------------------------------------------------------ the floor

/** The floor under the desk: a flat dark gradient (no wood: it is in the desk's shadow). One static canvas. */
function Floor({ width, height }: { width: number; height: number }) {
  return (
    <Canvas
      style={StyleSheet.flatten([styles.abs, { top: 0, width, height }])}
      pointerEvents="none"
      __destroyWebGLContextAfterRender={Platform.OS === 'web'}
    >
      <SkRect x={0} y={0} width={width} height={height}>
        <LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={[...DESK.floor]} />
      </SkRect>
    </Canvas>
  );
}

/**
 * The desk edge's shadow falling into a drawer while it moves (the box draws its own, exact at t = 1),
 * hung under the nosing over the drawer's column. Mounted with the boxes, shown only in motion.
 */
function EdgeFall({
  drawer,
  layout,
  t,
  lift,
  bandY,
}: {
  drawer: DrawerKey;
  layout: DeskLayout;
  t: SharedValue<number>;
  lift: DerivedValue<number>;
  bandY: SharedValue<number>;
}) {
  const f = layout.fronts[drawer];
  const { band } = layout;
  const style = useAnimatedStyle(() => {
    const v = t.get();
    return { opacity: Math.max(0, Math.min(1, v * 20, (1 - v) * 8)), transform: [{ translateY: -lift.get() + bandY.get() }] };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.abs, { left: f.x, top: band.top + band.nosing, width: f.width, height: EDGE_SHADOW.depth }, style]}
    >
      <EdgeShadow width={f.width} />
    </Animated.View>
  );
}

/** Reduce Motion: a drawer's opening in the apron while the drawer is out (it fades in with the panel). */
function Cavity({
  drawer,
  layout,
  t,
  bandY,
}: {
  drawer: DrawerKey;
  layout: DeskLayout;
  t: SharedValue<number>;
  bandY: SharedValue<number>;
}) {
  const f = layout.fronts[drawer];
  const style = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, t.get())),
    transform: [{ translateY: bandY.get() }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.abs, styles.cavity, { left: f.x - 1, top: f.y - 1, width: f.width + 2, height: f.height + 2 }, style]}
    />
  );
}

// ------------------------------------------------------------------ a drawer: its box, captions and items

type DrawerLayerProps = {
  drawer: DrawerKey;
  layout: DeskLayout;
  preset: Country;
  seed: number;
  lang: Lang;
  inUse: InUse;
  slots: Slot[];
  t: SharedValue<number>;
  tug: SharedValue<number>;
  peek: SharedValue<number>;
  lift: DerivedValue<number>;
  bandY: SharedValue<number>;
  rm: boolean;
  mounted: boolean;
  onTop: boolean;
  interactive: boolean;
  lifted?: string;
  carry: Carry;
  homes: Partial<Record<DeskItemId, ItemHome>>;
  dropY: number;
  locked: (item: DeskItem) => boolean;
  focusRef: Ref<ViewRef>;
  debug: boolean;
};

/**
 * One drawer's box at (front.x, front.y − depth): at t = 0 its front lies exactly over the apron's closed
 * front, and its interior hides under the scroll view. It moves by −C·t + H·t (= −D·t alone, or with the
 * desk when another drawer has the camera); under Reduce Motion it fades in at its t = 1 place instead.
 */
function DrawerLayer({
  drawer,
  layout,
  preset,
  seed,
  lang,
  inUse,
  slots,
  t,
  tug,
  peek,
  lift,
  bandY,
  rm,
  mounted,
  onTop,
  interactive,
  lifted,
  carry,
  homes,
  dropY,
  locked,
  focusRef,
  debug,
}: DrawerLayerProps) {
  const copy = DESK_COPY[lang];
  const f = layout.fronts[drawer];
  const g = layout.drawers[drawer];
  const cap = 1 + 6 / g.travel;
  const style = useAnimatedStyle(() => {
    if (rm) return { opacity: Math.max(0, Math.min(1, t.get())), transform: [{ translateY: -g.travel + bandY.get() }] };
    // While the band is away (keyboard up) the box would show its interior under the scroll view: it hides
    // (closed, its front is the apron's own, pixel for pixel, so nothing pops).
    return {
      opacity: bandY.get() > 0.01 ? 0 : 1,
      transform: [{ translateY: -lift.get() + g.depth * Math.min(t.get(), cap) + tug.get() - PEEK * peek.get() + bandY.get() }],
    };
  });
  const captions = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(1, (t.get() - 0.6) / 0.35)) }));
  const firstTakeable = slots.findIndex((s) => !(s.inUse && (s.item.kind === 'pen' || s.item.kind === 'ink')));

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.abs,
        { left: f.x, top: f.y - g.depth, width: f.width, height: g.depth + f.height, zIndex: onTop ? 2 : 1 },
        style,
      ]}
    >
      {/* Under Reduce Motion the box is a panel over the dimmed scene: it casts a soft shadow on it. */}
      {mounted && rm && (
        <View pointerEvents="none" style={[styles.panelShadow, { width: f.width, height: g.depth + f.height }]} />
      )}
      {mounted && (
        <Counted name={`box.${drawer}`} on={debug}>
          <DrawerBox drawer={drawer} layout={layout} preset={preset} seed={seed} inUse={inUse} lifted={lifted} lang={lang} />
        </Counted>
      )}
      {mounted && (
        // As wide as the screen (a caption may run far beside its drawer), in the box's own y.
        <Animated.View
          pointerEvents="none"
          style={[styles.captions, { left: -f.x, width: layout.width, height: g.depth + f.height }, captions]}
        >
          {captionPlaces(layout, drawer, slots, (s) => captionText(copy, s)).map((c) => (
            <Text
              key={c.id}
              numberOfLines={c.lines}
              style={[
                styles.caption,
                {
                  left: c.x,
                  top: c.y,
                  width: c.width,
                  fontSize: c.size,
                  lineHeight: c.lineHeight,
                  opacity: locked(c.slot.item) ? 0.6 : 1,
                },
                c.align === 'right' && styles.right,
              ]}
            >
              {c.text}
            </Text>
          ))}
        </Animated.View>
      )}
      {interactive &&
        slots.map((s, i) => {
          // A screen reader or the keyboard lands on the first item that can be taken (not the pen in hand).
          const home = homes[s.item.id];
          if (!home) return null;
          return (
            <ItemHit
              key={s.item.id}
              item={s.item}
              hit={{ x: DRAWER_WALL + s.hit.x, y: s.hit.y, width: s.hit.width, height: s.hit.height }}
              home={home}
              dropY={dropY}
              enabled={interactive}
              inUse={s.inUse}
              label={copy.a11yItem(s.item.id, s.inUse)}
              rm={rm}
              carry={carry}
              focusRef={i === firstTakeable ? focusRef : undefined}
            />
          );
        })}
    </Animated.View>
  );
}

const captionText = (copy: (typeof DESK_COPY)['ru'], s: Slot) => {
  const name = copy.items[s.item.id];
  if (!s.inUse) return name;
  // The envelope (or paper) in use gets a pencil tick; a pen or bottle in use isn't in the drawer at all.
  return s.item.kind === 'pen' || s.item.kind === 'ink' ? `${name} · ${copy.inUse}` : `${name} ✓`;
};

/**
 * Where each caption goes (§3.1): in the floor beside the open drawer, each level with its item's row (over a
 * neighbour's closed front where the row is beside one, on its dark pill), in one size for the whole drawer:
 * 13 pt on one line where every caption fits, else 11 pt wrapped to two or three lines. Captions on the same
 * side never overlap (pushed apart, keeping their order) and never run past the foot of the drawer's front.
 * x in screen coordinates, y in the box's.
 */
function captionPlaces(layout: DeskLayout, drawer: DrawerKey, slots: Slot[], textOf: (s: Slot) => string) {
  const f = layout.fronts[drawer];
  const foot = layout.drawers[drawer].depth + f.height;
  // Roughly 0.6 em a character, plus the pill's padding.
  const need = (text: string, size: number) => text.length * size * 0.6 + 12;
  const anchors = slots.map((s) => {
    const text = textOf(s);
    const ax = f.x + DRAWER_WALL + s.caption.x;
    const room = Math.max(40, s.caption.align === 'left' ? layout.width - ax - 8 : ax - 8);
    return { s, text, ax, room };
  });
  const one = anchors.every((a) => need(a.text, 13) <= a.room);
  const size = one ? 13 : 11;
  const lineHeight = one ? 16 : 13;
  const placed = anchors.map(({ s, text, ax, room }) => {
    const fits = need(text, size) <= room;
    const lines = fits ? 1 : Math.min(3, Math.max(2, Math.ceil((need(text, size) - 12) / (room - 24))));
    const height = lineHeight * lines + 4;
    // A right-aligned caption ends at its anchor.
    const width = Math.min(room, Math.ceil(fits ? need(text, size) : (need(text, size) - 12) / lines + 24));
    const x = s.caption.align === 'left' ? ax : ax - width;
    return {
      id: s.item.id,
      slot: s,
      text,
      x,
      y: s.caption.y - height / 2,
      width,
      size,
      lineHeight,
      lines,
      height,
      align: s.caption.align,
    };
  });
  for (const align of ['left', 'right'] as const) {
    const column = placed.filter((c) => c.align === align).sort((a, b) => a.y - b.y);
    let floor = 0;
    for (const c of column) {
      c.y = Math.max(c.y, floor);
      floor = c.y + c.height + 2;
    }
    // Pushed past the front's foot: the column moves up as a whole (never above the box).
    const over = floor - 2 - foot;
    if (over > 0) for (const c of column) c.y = Math.max(0, c.y - over);
  }
  return placed;
}

// ------------------------------------------------------------------ a front's touch target

/**
 * A front's touch target, moving with its front: the pan (and hover) on top for fingers and mice, a
 * Pressable under it for a screen reader and the keyboard (Enter / Space toggle it on web).
 */
function FrontHit({
  drawer,
  layout,
  drawers,
  bandY,
  rm,
  hidden,
  label,
  expanded,
  pressRef,
  onPress,
}: {
  drawer: DrawerKey;
  layout: DeskLayout;
  drawers: Drawers;
  bandY: SharedValue<number>;
  rm: boolean;
  hidden: boolean;
  label: string;
  expanded: boolean;
  pressRef: Ref<ViewRef>;
  onPress: () => void;
}) {
  const f = layout.fronts[drawer];
  const g = layout.drawers[drawer];
  const cap = 1 + 6 / g.travel;
  const t = drawers.t[drawer];
  const tug = drawers.tug[drawer];
  const peek = drawers.peek[drawer];
  const { lift, held } = drawers;
  const style = useAnimatedStyle(() => {
    if (rm) return { transform: [{ translateY: bandY.get() }] };
    return {
      transform: [{ translateY: -lift.get() + g.depth * Math.min(t.get(), cap) + tug.get() - PEEK * peek.get() + bandY.get() }],
    };
  });
  // Held: the front darkens a shade under the finger.
  const shade = useAnimatedStyle(() => ({ opacity: held.get() === drawer ? 1 : 0 }));
  const cursor = Platform.OS === 'web' ? ({ cursor: drawers.dragging === drawer ? 'grabbing' : 'grab' } as object) : null;
  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      style={[styles.abs, { left: f.x, top: f.y, width: f.width, height: f.height }, style]}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.held, shade]} />
      <Pressable
        ref={pressRef}
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded }}
        onPress={onPress}
      />
      <GestureDetector gesture={drawers.gestures[drawer]} touchAction="none">
        <View style={[StyleSheet.absoluteFill, cursor]} accessible={false} importantForAccessibility="no-hide-descendants" />
      </GestureDetector>
    </Animated.View>
  );
}

// ------------------------------------------------------------------ the hint line

/**
 * The hint line (§4.2), a polite live region: on the wood just above the band, or in the floor at the foot
 * of the screen under an open drawer (under Reduce Motion: above the panel). It fades after 3.5 s, except the sealed-letter
 * question with its «Взять» / «Оставить». With `needsButtons` a quiet «Задвинуть ящик» sits under the open drawer.
 */
function HintArea({
  layout,
  lang,
  hint,
  open,
  rm,
  frontBottom,
  panelTop,
  closeLink,
  onClose,
  onTake,
  onKeep,
  typing,
}: {
  layout: DeskLayout;
  lang: Lang;
  hint: Hint | null;
  open: DrawerKey | null;
  rm: boolean;
  frontBottom: number;
  panelTop: number;
  closeLink: boolean;
  onClose: () => void;
  onTake: (id: DeskItemId) => void;
  onKeep: () => void;
  typing: boolean;
}) {
  const copy = DESK_COPY[lang];
  const { band, width, height } = layout;
  const under = !!open && !rm;
  const maxWidth = Math.min(layout.mode === 'laptop' ? 560 : 360, width - 32);
  // Where the line sits: under the open front, above the panel, or just above the band.
  // (Under an open drawer it sits at the foot of the screen: the drawer's captions may run below its front.)
  const place = under
    ? { bottom: Math.max(layout.insets.bottom, 8) + 6 }
    : open && rm
      ? { bottom: height - panelTop + 8 }
      : { bottom: height - band.top + 8 };
  const link =
    closeLink && open ? (
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        style={[
          styles.closeLink,
          {
            top: frontBottom + 4,
            // Under its drawer, kept on screen (the envelope drawer's front runs off the right edge).
            left: Math.min(width - CLOSE_W - 8, Math.max(8, layout.fronts[open].x + layout.fronts[open].width / 2 - CLOSE_W / 2)),
          },
        ]}
      >
        <Text style={styles.link}>{copy.close}</Text>
      </Pressable>
    ) : null;
  if (typing) return null;
  return (
    <>
      {link}
      {hint && (
        // One line that changes its words in place: a fade only when it appears and when it goes.
        <Animated.View
          key="hint"
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(400)}
          pointerEvents="box-none"
          style={[styles.hintArea, place, { left: 16, right: 16 }]}
        >
          {/* Only the question's buttons take touches: a passing hint never blocks the controls under it. */}
          <View style={[styles.hintPill, { maxWidth }]} pointerEvents={hint.confirm ? 'box-none' : 'none'}>
            <Text style={styles.hintText} accessibilityLiveRegion="polite">
              {copy.hints[hint.key]}
            </Text>
            {hint.confirm && (
              <View style={styles.buttons}>
                <Pressable onPress={() => onTake(hint.confirm!)} accessibilityRole="button" style={styles.strong}>
                  <Text style={styles.strongText}>{copy.take}</Text>
                </Pressable>
                <Pressable onPress={onKeep} accessibilityRole="button" style={styles.quiet}>
                  <Text style={styles.link}>{copy.keep}</Text>
                </Pressable>
              </View>
            )}
          </View>
        </Animated.View>
      )}
    </>
  );
}

// ------------------------------------------------------------------ ?debug=1: render counters

const counts: Record<string, number> = {};

/** Counts the renders of what it wraps (lab `?debug=1`): typing must not redraw the desk. */
function Counted({ name, on, children }: { name: string; on: boolean; children: ReactNode }) {
  useEffect(() => {
    if (on) counts[name] = (counts[name] ?? 0) + 1;
  });
  return children;
}

function DebugCounts() {
  const [text, setText] = useState('');
  useEffect(() => {
    const id = setInterval(
      () =>
        setText(
          Object.entries(counts)
            .map(([k, v]) => `${k} ${v}`)
            .join(' · '),
        ),
      500,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <Text pointerEvents="none" style={styles.debug} testID="desk-debug">
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden', backgroundColor: DESK.floor[1] },
  abs: { position: 'absolute', left: 0 },
  scroll: { backgroundColor: DESK.background },
  content: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  sheet: { alignItems: 'center' },
  title: { color: '#efe2cc', fontSize: 22, fontFamily: 'MarckScript_400Regular', marginTop: 4 },
  hint: { color: HINT_COLOR, fontSize: 13, textAlign: 'center' },
  // Dimmed toward the floor's own colour: the darkest gaps never go black.
  dim: { backgroundColor: DESK.floor[1] },
  cavity: { backgroundColor: '#0b0806', boxShadow: 'inset 0px 5px 7px rgba(0, 0, 0, 0.7)' },
  panelShadow: {
    position: 'absolute',
    left: 0,
    top: 0,
    backgroundColor: DESK.floor[1],
    boxShadow: '0px 8px 16px rgba(0, 0, 0, 0.35)',
  },
  held: { backgroundColor: 'rgba(12, 7, 3, 0.12)' },
  captions: { position: 'absolute', top: 0 },
  caption: {
    position: 'absolute',
    color: HINT_COLOR,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
    // Legible anywhere: on the floor, over a neighbour's closed front, on the dimmed desk beside the Reduce
    // Motion panel (opaque enough that a front's card never reads through it).
    backgroundColor: 'rgba(15, 11, 8, 0.82)',
    overflow: 'hidden',
  },
  right: { textAlign: 'right' },
  hintArea: { position: 'absolute', alignItems: 'center' },
  hintPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: 'rgba(15, 11, 8, 0.72)',
    alignItems: 'center',
    gap: 6,
  },
  hintText: { color: HINT_COLOR, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  strong: { minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 3, backgroundColor: '#efe2cc' },
  strongText: { color: '#2a211b', fontSize: 14 },
  quiet: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 10 },
  link: { color: '#b9a88f', fontSize: 13, textDecorationLine: 'underline' },
  closeLink: {
    position: 'absolute',
    width: CLOSE_W,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    // Legible over whatever lies under the open drawer (the dimmed desk under Reduce Motion).
    borderRadius: 4,
    backgroundColor: 'rgba(15, 11, 8, 0.72)',
  },
  debug: { position: 'absolute', top: 4, right: 4, color: '#9f9', fontSize: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 2 },
});
