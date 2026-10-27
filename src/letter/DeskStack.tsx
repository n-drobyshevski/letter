import { Canvas, Group, Image, Paint, Picture, RadialGradient, Rect, Skia, useFont, vec, type SkPicture, type Transforms3d } from '@shopify/react-native-skia';
import { useEffect, useId, useMemo, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureDetector, MouseButton, PointerType, usePanGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
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
import { HANDWRITING_FONTS } from '../theme/stationery';
import { bakeSheetFaces, paperEdgeColor, useGhostOf, useSheetFaces, type LetterLook, type SheetFaces } from './LetterSheet';
import { HOME, deskBounds, dragPlacement, fanOut, groupCentre, moveGroup, nextPlacement, sheetAt, sweep, twistGroup, type Placement } from './deskMove';
import { fontSizeFor, paperFor } from './sheet';
import { useShadow, type ShadowSpec } from './raster';
import { mirrorPicture } from './showThrough';
import {
  MAX_SHEETS,
  MULTI_SHEET,
  emptyFace,
  emptySheet,
  faceOf,
  isEmptyFace,
  isEmptySheet,
  sheetJitter,
  withFace,
  type FaceRef,
  type SheetContent,
} from './stack';
import { MAX_TILT, freeGripOf, gripOf, type Grip } from './grip';
import type { Stroke } from './strokes';
import { WritingDesk, type WritingMode } from './WritingDesk';

/**
 * The writing desk with a small stack of sheets: write on the front, turn the
 * sheet over like a book page to write on the back (if this sheet is two-sided),
 * take another sheet. Each face keeps its own text and strokes; nothing flows.
 * The turn is drawn on a Skia overlay with both faces baked: a native TextInput
 * can't turn in 3D, so the desk under it waits, hidden, and changes face when the
 * turn lands. A turn is a button or the hand: take the sheet anywhere along its right
 * edge and drag left to turn forward (to the back, then the next sheet), along its
 * left edge and drag right to come back. The sheet follows the finger, and how it is
 * taken shapes the turn: the axis leans with the drag's direction and with where the
 * edge was taken (from the top corner, the top leads), the sheet travels a little
 * with the hand, and a slide to another sheet goes the way it was pushed. Released
 * past halfway (or flicked) it completes, otherwise it falls back.
 *
 * On the laptop (a wide web window) the sheets lie loose on the desk instead: a new
 * sheet goes on top of the others, a little offset, and the earlier ones stay where
 * they were. You write on the one on top, straightened in front of you. Space + drag
 * moves any sheet (and brings it to the top), a click on one brings it to the top,
 * Ctrl (⌘) + drag anywhere on the top sheet turns it over (leftward to its back,
 * rightward to its front again); a plain drag writes or draws.
 */

const web = Platform.OS === 'web';
// Wide enough for sheets to lie side by side: the laptop.
const LOOSE_MIN_WIDTH = 760;

// The edge strips that take a drag (pt), and the lifted-corner hint at their foot.
const EDGE = 30;
const CORNER = { w: 56, h: 88 };

type Turn = {
  kind: 'flip' | 'slide';
  /** 1 forward (to the back, the next sheet), -1 back. */
  dir: 1 | -1;
  from: SkPicture;
  to: SkPicture;
  target: FaceRef;
  /** Done once it lands (taking a new sheet). */
  apply?: () => void;
};
type Side = FaceRef['side'];

const PERSPECTIVE = 1400;
// Each desk's top-sheet bake (see facesOf), by the desk's useId.
const topBakes = new Map<string, { sheet: SheetContent; index: number; look: string; faces: SheetFaces }>();
// The line round sheets picked with Shift + click.
const CHOSEN = 'rgba(214, 170, 92, 0.9)';
// A loose sheet on the desk (baked once: raster.ts).
const LOOSE_SHADOW: ShadowSpec[] = [{ dx: 2, dy: 5, blur: 9, color: 'rgba(20, 12, 4, 0.32)' }];
const COPY = {
  sheet: (i: number, n: number, back: boolean) => `Лист ${i + 1} из ${n}${back ? ' · оборот' : ''}`,
  turn: 'Перевернуть',
  turnBack: 'На лицевую',
  twoSided: 'Писать на обороте',
  more: 'Ещё лист',
  remove: 'Убрать лист',
  prev: '← Лист',
  next: 'Лист →',
  sureRemove: 'На этом листе есть написанное. Убрать?',
  sureBack: 'На обороте есть написанное. Стереть его?',
  yes: 'Да',
  no: 'Нет',
  full: 'Больше листов в конверт не влезет',
  overflowTurn: 'Лист закончился — переверни или возьми ещё лист',
  overflowMore: 'Лист закончился — возьми ещё лист',
  overflowLast: 'Лист закончился, а листов больше нет',
  clearPen: 'Стереть перо',
  cornerForward: 'Край листа: потяни влево, чтобы перевернуть',
  cornerBack: 'Край листа: потяни вправо, чтобы вернуться',
  mouseHint:
    'Пробел + тяни — подвинуть лист · правой кнопкой — повернуть · щёлкни — наверх · Shift + щёлкни — выбрать несколько · Ctrl + тяни — перевернуть',
  mouseHintOne: 'Правой кнопкой — повернуть · Ctrl + тяни — перевернуть',
};

type Props = {
  look: LetterLook;
  width: number;
  height: number;
  mode: WritingMode;
  sheets: SheetContent[];
  onSheets: (sheets: SheetContent[]) => void;
  /** Most sheets allowed (fewer once the letter is folded in four). */
  maxSheets?: number;
  placeholder?: string;
  /** Lab/QA: start on this face (0-based, sheet × 2 + back) and freeze a turn of the sheet at this progress. */
  initialFace?: number;
  fixedTurn?: number;
  /** Lab/QA: the turn's axis lean for that frozen turn (rad). */
  fixedTilt?: number;
};

export function DeskStack({ look, width, height, mode, sheets, onSheets, maxSheets = MAX_SHEETS, placeholder, initialFace = 0, fixedTurn, fixedTilt }: Props) {
  const [face, setFace] = useState<FaceRef>(() => {
    const sheet = Math.min(sheets.length - 1, Math.floor(initialFace / 2));
    return { sheet, side: initialFace % 2 && sheets[sheet]?.twoSided ? 'verso' : 'recto' };
  });
  const [ask, setAsk] = useState<'remove' | 'back' | null>(null);
  const [turning, setTurning] = useState<Turn | null>(null);
  const sheet = sheets[face.sheet] ?? emptySheet(look.paper);
  const current = faceOf(sheets, face);
  const other: FaceRef = { sheet: face.sheet, side: face.side === 'recto' ? 'verso' : 'recto' };
  const ghost = useGhostOf(faceOf(sheets, other), other, look, width, height, width);
  // Finished faces for the turn overlay: baked when the pen rests or a turn starts, not on every keystroke.
  const font = useFont(HANDWRITING_FONTS[look.font].file, fontSizeFor(paperFor(look.paper, width), width));
  // The top sheet's faces are kept here rather than with the sheet: it is baked again after
  // every pause in the writing, and each bake holds two full-size images, so the one it
  // replaces is freed at once (only a turn draws it, and none is under way while you write).
  const desk = useId();
  useEffect(() => () => void topBakes.delete(desk), [desk]);
  const facesOf = (i: number, s: SheetContent | undefined = sheets[i]) => {
    if (!font || !s) return null;
    if (i !== face.sheet) return bakeSheetFaces(font, s, i, look, width, height, 0, 'tri', width);
    const id = `${look.paper}|${look.ink}|${look.font}|${look.seed}|${width}|${height}`;
    const kept = topBakes.get(desk);
    if (kept?.sheet === s && kept.index === i && kept.look === id) return kept.faces;
    const faces = bakeSheetFaces(font, s, i, look, width, height, 0, 'tri', width, false);
    if (kept) for (const pic of [kept.faces.recto, kept.faces.verso, kept.faces.versoThrough]) pic.dispose();
    topBakes.set(desk, { sheet: s, index: i, look: id, faces });
    return faces;
  };
  const frozen = useMemo(
    () => (fixedTurn !== undefined && font ? bakeSheetFaces(font, sheet, face.sheet, look, width, height, 0, 'tri', width) : null),
    // QA frames only: bake once the font is in
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fixedTurn, font],
  );
  const reduceMotion = useReducedMotion();

  // ── The loose desk (laptop): every sheet where it was put, the one on top to write on ──
  const { width: screenW } = useWindowDimensions();
  const loose = web && MULTI_SHEET && screenW >= LOOSE_MIN_WIDTH;
  const size = { width, height };
  const area = loose ? { width: Math.max(width, Math.min(screenW - 32, Math.round(width * 2.15))), height: height + 48 } : size;

  // Bottom to top; the top one is `face.sheet`.
  const [order, setOrder] = useState<number[]>(() => [...sheets.keys()].filter((i) => i !== face.sheet).concat(face.sheet));
  const orderNow = useSharedValue(order);
  // Which side is up on each sheet lying under the top one.
  const [sides, setSides] = useState<Side[]>(() => sheets.map(() => 'recto'));
  const placements = useSharedValue<Placement[]>(fanOut(sheets.length, size, area, (i) => sheetJitter(look.seed, i + 1).rot * 3));
  // The top sheet settling in front of you (0 as it lies, 1 settled): straight, or at the
  // angle you turned it to with the right button (its aim).
  const straight = useSharedValue(0);
  const restack = (next: number[]) => {
    setOrder(next);
    orderNow.set(next);
  };
  /** Settle sheet `i` (on top) to write on it: straight, or at the angle it was turned to by hand. */
  const straighten = (i: number) => {
    'worklet';
    straight.set(0);
    straight.set(
      withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }, (finished) => {
        if (!finished) return;
        const next = placements.get().slice();
        if (next[i]) next[i] = { ...next[i], rot: next[i].aim ?? 0 };
        placements.set(next);
        straight.set(0);
      }),
    );
  };
  // Sheets picked with Shift + click, to move or turn as one (Space + drag, the right button).
  const [chosen, setChosen] = useState<number[]>([]);
  const chosenNow = useSharedValue<number[]>([]);
  const choose = (next: number[]) => {
    setChosen(next);
    chosenNow.set(next);
  };
  /** Shift + click: sheet `i` into the pick, or out of it; on the bare desk, none. */
  const toggleChosen = (i: number) => {
    const now = chosenNow.get();
    choose(i < 0 ? [] : now.includes(i) ? now.filter((j) => j !== i) : [...now, i]);
  };
  /**
   * Sheet `i` to the top of the desk, to write on (the one there now keeps the side it shows).
   * With `along` (the other sheets picked with it), those come up too, just under it, in their order.
   */
  const bringToTop = (i: number, along: number[] = []) => {
    if (i < 0 || i >= sheets.length) return;
    const others = along.filter((j) => j !== i);
    if (i === face.sheet && others.length === 0) return;
    if (i !== face.sheet) {
      Keyboard.dismiss();
      setAsk(null);
      const kept = sides.slice();
      kept[face.sheet] = face.side;
      setSides(kept);
      setFace({ sheet: i, side: sheets[i].twoSided ? (kept[i] ?? 'recto') : 'recto' });
    }
    restack(order.filter((j) => j !== i && !others.includes(j)).concat(order.filter((j) => others.includes(j)), i));
    straighten(i);
  };

  const p = useSharedValue(fixedTurn ?? 0);
  // The hand's grip on the turn under way (buttons turn square, pushed the plain way).
  const grip = useSharedValue<Grip>({ tilt: fixedTilt ?? 0, ux: -1, uy: 0 });
  useEffect(() => {
    if (fixedTurn !== undefined) p.set(fixedTurn);
    if (fixedTilt !== undefined) grip.set({ tilt: fixedTilt, ux: -Math.cos(fixedTilt), uy: Math.sin(fixedTilt) });
  }, [fixedTurn, fixedTilt, p, grip]);

  const setCurrent = (next: { text?: string; strokes?: Stroke[] }) => onSheets(withFace(sheets, face, { ...current, ...next }));

  // Where the turn under way lands. Kept as a shared value: the corner's gesture callbacks
  // were made in an earlier render, so they can't read this render's state.
  const target = useSharedValue<FaceRef | null>(null);

  // The faces a turn from here would show, baked while the pen rests: a turn then starts
  // at once instead of baking under the hand.
  useEffect(() => {
    if (!font || !MULTI_SHEET || fixedTurn !== undefined) return;
    const timer = setTimeout(() => {
      // Never while a turn is drawing the top sheet's faces.
      if (target.get()) return;
      const near = loose ? [face.sheet] : [face.sheet, face.sheet + 1, face.sheet - 1];
      for (const i of near) {
        const s = sheets[i];
        if (s && (i !== face.sheet || s.twoSided || (!loose && sheets.length > 1))) facesOf(i);
      }
    }, 600);
    return () => clearTimeout(timer);
    // facesOf reads only these
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font, sheets, face.sheet, look, width, height, fixedTurn, loose]);

  const begin = (turn: Turn | null) => {
    Keyboard.dismiss();
    setAsk(null);
    target.set(turn?.target ?? null);
    setTurning(turn);
  };
  // A steep free turn (top over bottom) spins the sheet past the overlay's usual room: the
  // overlay grows for it as the lean passes MAX_TILT, and back once the turn lands. Sideways
  // turns keep the small canvas (a canvas is filled whole every frame of a turn).
  const [steep, setSteep] = useState(() => Math.abs(fixedTilt ?? 0) > MAX_TILT);
  useAnimatedReaction(
    () => loose && p.value > 0 && p.value < 1 && Math.abs(grip.value.tilt) > MAX_TILT,
    (now, prev) => {
      if (now && !prev) scheduleOnRN(setSteep, true);
    },
  );
  const land = (commit: boolean, apply?: () => void) => {
    const to = target.get();
    target.set(null);
    if (to && commit) {
      apply?.();
      setFace(to);
    }
    setTurning(null);
    setSteep(false);
  };
  /** A turn by button: the whole way, on its own. */
  const play = (turn: Turn | null) => {
    if (!turn) return;
    begin(turn);
    const finish = () => land(true, turn.apply);
    grip.set({ tilt: 0, ux: -turn.dir, uy: 0 });
    p.set(0);
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(finish);
    };
    p.set(
      reduceMotion || turn.kind === 'slide'
        ? withTiming(1, { duration: reduceMotion ? 150 : 320, easing: Easing.out(Easing.cubic) }, done)
        : withSpring(1, { damping: 20, stiffness: 150, mass: 0.9 }, done),
    );
  };

  /** Over to the other side of this sheet. */
  const flip = (): Turn | null => {
    const f = facesOf(face.sheet);
    if (!f || !sheet.twoSided) return null;
    const toVerso = face.side === 'recto';
    return { kind: 'flip', dir: toVerso ? 1 : -1, from: f[face.side], to: f[other.side], target: other };
  };
  /** To another sheet (forward: it lies underneath; back: it comes back on top). */
  const slide = (target: FaceRef, apply?: () => void, next?: SheetContent): Turn | null => {
    const here = facesOf(face.sheet);
    const there = facesOf(target.sheet, next);
    if (!here || !there) return null;
    return { kind: 'slide', dir: target.sheet > face.sheet ? 1 : -1, from: here[face.side], to: there[target.side], target, apply };
  };
  // On the loose desk the edges only turn the sheet over: other sheets are fetched by hand.
  const forward = (): Turn | null =>
    face.side === 'recto' && sheet.twoSided ? flip() : !loose && face.sheet < sheets.length - 1 ? slide({ sheet: face.sheet + 1, side: 'recto' }) : null;
  const backward = (): Turn | null => {
    if (face.side === 'verso') return flip();
    if (loose || face.sheet === 0) return null;
    // The page written just before this one: the back of the previous sheet, if it has one.
    const prev = sheets[face.sheet - 1];
    return slide({ sheet: face.sheet - 1, side: prev.twoSided ? 'verso' : 'recto' });
  };

  const turnOver = () => play(flip());
  const goTo = (i: number) => (loose ? bringToTop(i) : play(slide({ sheet: i, side: 'recto' })));
  const addSheet = () => {
    const blank = emptySheet(look.paper);
    if (!loose) return play(slide({ sheet: sheets.length, side: 'recto' }, () => onSheets([...sheets, blank]), blank));
    // Laid on top of the others, a little offset: the earlier sheets stay on the desk.
    choose([]);
    const i = sheets.length;
    const now = placements.get();
    placements.set([...now, nextPlacement(now[face.sheet] ?? HOME, size, area, sheetJitter(look.seed, i + 1).rot * 3)]);
    const kept = sides.slice();
    kept[face.sheet] = face.side;
    setSides([...kept, 'recto']);
    onSheets([...sheets, blank]);
    setFace({ sheet: i, side: 'recto' });
    restack([...order, i]);
    Keyboard.dismiss();
    straighten(i);
  };

  // The sheet's edges: the finger writes p (0 → 1 is the whole turn) and the grip.
  // With a mouse (the laptop) only Ctrl (⌘) + drag turns, and from anywhere on the sheet
  // (a layer laid over it while Ctrl is held); a plain drag there writes or selects.
  // On the loose desk that drag turns the sheet over any way it goes (freeGripOf).
  const travel = width * 0.8;
  const grabX = useSharedValue(0);
  const grabYpx = useSharedValue(0);
  const grabY = useSharedValue(0.5);
  // A free turn's way (unit vector, set as it starts) and whether this sheet has a back to turn to.
  const way = useSharedValue({ x: -1, y: 0 });
  const canFlipNow = useSharedValue(false);
  const keys = useDeskKeys();
  const idle = useSharedValue(false);
  // Which way the turn under way goes (1 forward, -1 back), and which ways this face can turn:
  // shared values, since the gestures' callbacks were made in an earlier render.
  const turnDir = useSharedValue<1 | -1>(1);
  const canForwardNow = useSharedValue(false);
  const canBackwardNow = useSharedValue(false);
  // A Ctrl turn taken from the middle of the sheet: its layer stays until the drag ends.
  const [turningAnywhere, setTurningAnywhere] = useState(false);
  const startDrag = (dir: 1 | -1) => begin(dir === 1 ? forward() : backward());
  const startFlip = () => begin(flip());
  // How far a free turn's way takes the hand for the whole turn (a vertical one: the sheet's height).
  const travelFree = (u: { x: number; y: number }) => {
    'worklet';
    return 0.8 * (Math.abs(u.x) * width + Math.abs(u.y) * height);
  };
  /**
   * A turn by hand: from the right edge (1), the left edge (-1), or anywhere, the way the
   * drag goes (0): on the loose desk any way at all, elsewhere left forward and right back.
   */
  const turnGesture = (fixed: 1 | -1 | 0) => {
    const free = fixed === 0 && loose;
    return {
      // Not switched off while its own turn is under way: that would cancel the drag.
      enabled: fixedTurn === undefined && (fixed === 1 ? canForward : fixed === -1 ? canBackward : canForward || canBackward),
      // An edge only its own way; mostly vertical still scrolls the desk (not under Ctrl on the loose desk).
      activeOffsetX: fixed === 1 ? -6 : fixed === -1 ? 6 : ([-6, 6] as [number, number]),
      activeOffsetY: free ? ([-6, 6] as [number, number]) : undefined,
      failOffsetY: free ? undefined : ([-40, 40] as [number, number]),
      onBegin: (e: { x: number; y: number }) => {
        grabX.set(e.x);
        grabYpx.set(e.y);
        grabY.set(Math.min(1, Math.max(0, e.y / height)));
      },
      onActivate: (e: { x: number; y: number; translationX: number; translationY: number; pointerType: PointerType }) => {
        const mouse = e.pointerType === PointerType.MOUSE;
        // The way from where it was taken: on the web the activation's translation still reads 0.
        const dx = e.x - grabX.get();
        const dy = e.y - grabYpx.get();
        if (free) {
          idle.set((mouse && !keys.turn.get()) || !canFlipNow.get());
          if (idle.get()) return;
          const len = Math.hypot(dx, dy);
          const u = len < 1 ? { x: -1, y: 0 } : { x: dx / len, y: dy / len };
          const spin: 1 | -1 = u.x <= 0 ? 1 : -1;
          way.set(u);
          turnDir.set(spin);
          scheduleOnRN(setTurningAnywhere, true);
          p.set(0);
          grip.set(freeGripOf(spin, dx, dy, grabY.get()));
          scheduleOnRN(startFlip);
          return;
        }
        // Dragged left it turns forward (to the back, the next sheet), right it comes back.
        const dir: 1 | -1 = fixed !== 0 ? fixed : dx < 0 ? 1 : -1;
        const allowed = dir === 1 ? canForwardNow.get() : canBackwardNow.get();
        idle.set((mouse && !keys.turn.get()) || !allowed);
        if (idle.get()) return;
        turnDir.set(dir);
        if (fixed === 0) scheduleOnRN(setTurningAnywhere, true);
        p.set(0);
        grip.set(gripOf(dir, e.translationX, e.translationY, grabY.get()));
        scheduleOnRN(startDrag, dir);
      },
      onUpdate: (e: { translationX: number; translationY: number }) => {
        if (idle.get()) return;
        if (free) {
          const u = way.get();
          p.set(Math.min(1, Math.max(0, (e.translationX * u.x + e.translationY * u.y) / travelFree(u))));
          grip.set(freeGripOf(turnDir.get(), e.translationX, e.translationY, grabY.get()));
          return;
        }
        const dir = turnDir.get();
        p.set(Math.min(1, Math.max(0, (-dir * e.translationX) / travel)));
        grip.set(gripOf(dir, e.translationX, e.translationY, grabY.get()));
      },
      onDeactivate: (e: { velocityX: number; velocityY: number; canceled: boolean }) => {
        if (idle.get()) return idle.set(false);
        const u = way.get();
        const v = free ? (e.velocityX * u.x + e.velocityY * u.y) / travelFree(u) : (-turnDir.get() * e.velocityX) / travel;
        const commit = !e.canceled && (v > 0.5 || (v > -0.5 && p.get() > 0.5));
        const done = (finished?: boolean) => {
          'worklet';
          if (finished) scheduleOnRN(land, commit);
        };
        p.set(
          reduceMotion
            ? withTiming(commit ? 1 : 0, { duration: 150 }, done)
            : withSpring(commit ? 1 : 0, { velocity: v, damping: 20, stiffness: 150, mass: 0.9, overshootClamping: true }, done),
        );
      },
      onFinalize: () => {
        if (fixed === 0) scheduleOnRN(setTurningAnywhere, false);
      },
    };
  };
  const canForward = (face.side === 'recto' && sheet.twoSided) || (!loose && face.sheet < sheets.length - 1);
  const canBackward = face.side === 'verso' || (!loose && face.sheet > 0);
  const canFlip = sheet.twoSided;
  useEffect(() => {
    canForwardNow.set(canForward);
    canBackwardNow.set(canBackward);
    canFlipNow.set(canFlip);
  }, [canForward, canBackward, canFlip, canForwardNow, canBackwardNow, canFlipNow]);
  const forwardEdge = usePanGesture(turnGesture(1));
  const backEdge = usePanGesture(turnGesture(-1));
  const anywhere = usePanGesture(turnGesture(0));

  // The sheets a drag or a turn takes: the one under the pointer, or all those picked with
  // Shift + click if it is one of them (a worklet: the gestures read the pick as it is now).
  const takenWith = (i: number) => {
    'worklet';
    const picked = chosenNow.get();
    return picked.length > 1 && picked.includes(i) ? picked : [i];
  };
  // Space + drag on the loose desk: the sheet under the pointer comes to the top and follows the
  // hand; sheets picked together go as one, none turned.
  const [carrying, setCarrying] = useState(false);
  const carried = useSharedValue(-1);
  const carriedWith = useSharedValue<number[]>([]);
  const startsAtGrab = useSharedValue<Placement[]>([]);
  const placeAtGrab = useSharedValue<Placement>(HOME);
  const grabAt = useSharedValue({ x: 0, y: 0 });
  const carry = usePanGesture({
    enabled: loose,
    activeOffsetX: [-3, 3],
    activeOffsetY: [-3, 3],
    onBegin: (e) => {
      const i = sheetAt({ x: e.x, y: e.y }, placements.get(), orderNow.get(), size, area);
      carried.set(i);
      if (i < 0) return;
      const ids = takenWith(i);
      carriedWith.set(ids);
      startsAtGrab.set(placements.get());
      const pl = placements.get()[i];
      placeAtGrab.set(pl);
      grabAt.set({ x: e.x - area.width / 2 - pl.x, y: e.y - area.height / 2 - pl.y });
      scheduleOnRN(bringToTop, i, ids);
      scheduleOnRN(setCarrying, true);
    },
    onUpdate: (e) => {
      const i = carried.get();
      if (i < 0) return;
      const d = { x: e.translationX, y: e.translationY };
      const ids = carriedWith.get();
      if (ids.length > 1) {
        placements.set(moveGroup(startsAtGrab.get(), ids, d, size, area));
        return;
      }
      const next = placements.get().slice();
      next[i] = dragPlacement(placeAtGrab.get(), grabAt.get(), d, size, deskBounds(size, area));
      placements.set(next);
    },
    onFinalize: () => {
      const i = carried.get();
      carried.set(-1);
      scheduleOnRN(setCarrying, false);
      // Put down in front of you: straightened to write on.
      if (i >= 0) straighten(i);
    },
  });
  // A right-button drag on the loose desk turns the sheet under the pointer round its centre,
  // to any angle, by how far the hand sweeps round it; it comes to the top, and stays at that
  // angle (written on as it lies). Sheets picked together turn as one, round their middle.
  // No context menu on the desk, then.
  const twisted = useSharedValue(-1);
  const twistedWith = useSharedValue<number[]>([]);
  const twistCentre = useSharedValue({ x: 0, y: 0 });
  const sweptFrom = useSharedValue({ x: 0, y: 0 });
  const twist = usePanGesture({
    enabled: loose,
    mouseButton: MouseButton.RIGHT,
    activeOffsetX: [-3, 3],
    activeOffsetY: [-3, 3],
    onBegin: (e) => {
      const i = sheetAt({ x: e.x, y: e.y }, placements.get(), orderNow.get(), size, area);
      twisted.set(i);
      if (i < 0) return;
      const ids = takenWith(i);
      twistedWith.set(ids);
      // Round the middle of the sheets turned (one sheet: its own centre), which turning keeps.
      const c = groupCentre(placements.get(), ids);
      twistCentre.set(c);
      sweptFrom.set({ x: e.x - area.width / 2 - c.x, y: e.y - area.height / 2 - c.y });
      scheduleOnRN(bringToTop, i, ids);
    },
    onUpdate: (e) => {
      if (twisted.get() < 0) return;
      const c = twistCentre.get();
      const at = { x: e.x - area.width / 2 - c.x, y: e.y - area.height / 2 - c.y };
      const by = sweep(sweptFrom.get(), at);
      if (by === 0) return;
      sweptFrom.set(at);
      placements.set(twistGroup(placements.get(), twistedWith.get(), c, by));
    },
    onFinalize: () => {
      twisted.set(-1);
    },
  });
  // A click on a sheet lying under the top one brings it up.
  const pick = useTapGesture({
    enabled: loose,
    onActivate: (e) => {
      const i = sheetAt({ x: e.x, y: e.y }, placements.get(), orderNow.get(), size, area);
      if (i >= 0) scheduleOnRN(bringToTop, i);
    },
  });
  // Shift + click: a sheet into the pick or out of it (a layer over the desk while Shift is held).
  const chooser = useTapGesture({
    enabled: loose,
    onActivate: (e) => {
      scheduleOnRN(toggleChosen, sheetAt({ x: e.x, y: e.y }, placements.get(), orderNow.get(), size, area));
    },
  });
  // A plain click anywhere on the desk (on a sheet, in the writing, on the bare desk) lets the pick go.
  const letGo = useTapGesture({
    enabled: loose,
    onActivate: () => {
      if (!keys.pick.get() && chosenNow.get().length > 0) scheduleOnRN(choose, []);
    },
  });
  const deskGestures = useSimultaneousGestures(twist, letGo);
  // Esc lets it go too.
  useEffect(() => {
    if (!loose || chosen.length === 0) return;
    const win = (globalThis as unknown as { window?: { addEventListener: (t: string, f: (e: { key: string }) => void) => void; removeEventListener: (t: string, f: (e: { key: string }) => void) => void } }).window;
    if (!win) return;
    const esc = (e: { key: string }) => {
      if (e.key === 'Escape') choose([]);
    };
    win.addEventListener('keydown', esc);
    return () => win.removeEventListener('keydown', esc);
    // choose only sets the pick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loose, chosen.length]);
  // The sheets under the top one, baked once each (never the top one: it changes as you write).
  const under = (i: number) => (loose && i !== face.sheet ? sheets[i] : undefined);
  const u0 = useSheetFaces(under(0), 0, look, width, height, 0, 'tri', width);
  const u1 = useSheetFaces(under(1), 1, look, width, height, 0, 'tri', width);
  const u2 = useSheetFaces(under(2), 2, look, width, height, 0, 'tri', width);
  const u3 = useSheetFaces(under(3), 3, look, width, height, 0, 'tri', width);
  const underFaces = [u0, u1, u2, u3];
  const looseShadow = useShadow(size, LOOSE_SHADOW);
  const topPlaced = useAnimatedStyle(() => {
    const pl = placements.value[face.sheet] ?? HOME;
    return {
      transform: [{ translateX: pl.x }, { translateY: pl.y }, { rotate: `${pl.rot + ((pl.aim ?? 0) - pl.rot) * straight.value}rad` }],
    };
  });

  const removeSheet = () => {
    const gone = face.sheet;
    const next = sheets.filter((_, i) => i !== gone);
    onSheets(next);
    setAsk(null);
    if (!loose) return setFace({ sheet: Math.max(0, gone - 1), side: 'recto' });
    // The others keep their places; the one now on top is written on.
    choose([]);
    const shift = (j: number) => (j > gone ? j - 1 : j);
    const nextOrder = order.filter((j) => j !== gone).map(shift);
    const nextSides = sides.filter((_, j) => j !== gone);
    placements.set(placements.get().filter((_, j) => j !== gone));
    setSides(nextSides);
    restack(nextOrder);
    const top = nextOrder[nextOrder.length - 1] ?? 0;
    setFace({ sheet: top, side: next[top]?.twoSided ? (nextSides[top] ?? 'recto') : 'recto' });
    straighten(top);
  };
  const setTwoSided = (on: boolean) => {
    const next = sheets.map((s, i) => (i === face.sheet ? { ...s, twoSided: on, verso: on ? s.verso : emptyFace() } : s));
    onSheets(next);
    if (!on) setFace({ sheet: face.sheet, side: 'recto' });
    setAsk(null);
  };

  const last = face.sheet === sheets.length - 1;
  const canAdd = MULTI_SHEET && sheets.length < maxSheets;
  const overflowNote =
    face.side === 'recto' && sheet.twoSided
      ? COPY.overflowTurn
      : canAdd || !last
        ? COPY.overflowMore
        : COPY.overflowLast;

  // The sheet you write on, its edges and its turn.
  const writing = (
    <>
      {/* Hidden while the overlay turns the sheet: no touches either, or ink would land unseen on the new face. */}
      <View style={{ opacity: turning || fixedTurn !== undefined ? 0 : 1 }} pointerEvents={turning || fixedTurn !== undefined ? 'none' : 'auto'}>
        <WritingDesk
          look={look}
          width={width}
          height={height}
          mode={mode}
          face={face}
          ghost={ghost}
          text={current.text}
          onText={(text) => setCurrent({ text })}
          strokes={current.strokes}
          onStrokes={(strokes) => setCurrent({ strokes })}
          placeholder={face.sheet === 0 && face.side === 'recto' ? placeholder : undefined}
          overflowNote={overflowNote}
        />
      </View>
      {MULTI_SHEET && fixedTurn === undefined && (
        <>
          {/* Both corners stay mounted (a canvas is a WebGL context on the web); the one you can't take is hidden. */}
          <CornerLift side="right" shown={canForward} />
          <CornerLift side="left" shown={canBackward} />
          {canForward && (
            <GestureDetector gesture={forwardEdge} touchAction="pan-y">
              <View style={[styles.edge, { right: 0 }]} accessibilityLabel={COPY.cornerForward} />
            </GestureDetector>
          )}
          {canBackward && (
            <GestureDetector gesture={backEdge} touchAction="pan-y">
              <View style={[styles.edge, { left: 0 }]} accessibilityLabel={COPY.cornerBack} />
            </GestureDetector>
          )}
        </>
      )}
      {/* Ctrl (⌘) held: a layer over the sheet takes the drag and turns it, from anywhere. */}
      {web && MULTI_SHEET && fixedTurn === undefined && (turningAnywhere || (keys.turnHeld && (canForward || canBackward))) && (
        <GestureDetector gesture={anywhere}>
          <View style={[StyleSheet.absoluteFill, styles.grab]} />
        </GestureDetector>
      )}
      {/* Mounted for good, empty between turns: on the web a canvas is a WebGL context, slow to make and to lose. */}
      {MULTI_SHEET && (
        <TurnOverlay
          from={turning?.from ?? frozen?.recto ?? null}
          to={turning?.to ?? frozen?.verso ?? null}
          kind={turning?.kind ?? 'flip'}
          dir={turning?.dir ?? 1}
          grip={grip}
          fade={reduceMotion}
          free={loose && steep}
          p={p}
          width={width}
          height={height}
        />
      )}
    </>
  );

  return (
    <View style={styles.root}>
      {loose ? (
        // The right button turns sheets anywhere on the desk, over the one you write on too.
        <GestureDetector gesture={deskGestures} enableContextMenu={false}>
          <View style={{ width: area.width, height: area.height }}>
            {/* The sheets lying under the top one, where they were put. */}
            <GestureDetector gesture={pick}>
              <Canvas style={{ position: 'absolute', left: 0, top: 0, width: area.width, height: area.height }}>
                {order
                  .filter((i) => i !== face.sheet && underFaces[i])
                  .map((i) => (
                    <LooseSheet
                      key={i}
                      index={i}
                      faces={underFaces[i]!}
                      shadow={looseShadow}
                      side={sheets[i]?.twoSided ? (sides[i] ?? 'recto') : 'recto'}
                      chosen={chosen.includes(i)}
                      placements={placements}
                      area={area}
                      width={width}
                      height={height}
                    />
                  ))}
              </Canvas>
            </GestureDetector>
            <Animated.View style={[{ position: 'absolute', left: (area.width - width) / 2, top: (area.height - height) / 2, width, height }, topPlaced]}>
              {writing}
              {chosen.includes(face.sheet) && <View style={[StyleSheet.absoluteFill, styles.through, styles.chosen]} />}
            </Animated.View>
            {/* Shift held: a layer over the desk takes clicks and picks the sheet under the pointer. */}
            {keys.pickHeld && (
              <GestureDetector gesture={chooser}>
                <View style={[StyleSheet.absoluteFill, styles.choosing]} />
              </GestureDetector>
            )}
            {/* Space held: a layer over the desk takes the drag and moves the sheet under the pointer. */}
            {(keys.moveHeld || carrying) && (
              <GestureDetector gesture={carry}>
                <View style={[StyleSheet.absoluteFill, styles.grab]} />
              </GestureDetector>
            )}
          </View>
        </GestureDetector>
      ) : (
        <View style={{ width, height }}>
          {sheets.length > 1 && <StackEdges count={sheets.length - 1} seed={look.seed} width={width} height={height} paper={look.paper} />}
          {writing}
        </View>
      )}

      <View style={styles.row}>
        {current.strokes.length > 0 && <DeskButton label={COPY.clearPen} onPress={() => setCurrent({ strokes: [] })} />}
      </View>
      {MULTI_SHEET && (
        <>
          <Text style={styles.where} accessibilityLiveRegion="polite">
            {COPY.sheet(face.sheet, sheets.length, face.side === 'verso')}
          </Text>
          {loose && <Text style={styles.where}>{sheets.length > 1 ? COPY.mouseHint : COPY.mouseHintOne}</Text>}
          {ask ? (
            <View style={styles.row}>
              <Text style={styles.ask}>{ask === 'remove' ? COPY.sureRemove : COPY.sureBack}</Text>
              <DeskButton label={COPY.yes} onPress={() => (ask === 'remove' ? removeSheet() : setTwoSided(false))} />
              <DeskButton label={COPY.no} onPress={() => setAsk(null)} />
            </View>
          ) : (
            <View style={styles.row}>
              {face.sheet > 0 && <DeskButton label={`${COPY.prev} ${face.sheet}`} onPress={() => goTo(face.sheet - 1)} />}
              {sheet.twoSided && <DeskButton label={face.side === 'recto' ? COPY.turn : COPY.turnBack} strong onPress={turnOver} />}
              <DeskButton
                label={`${sheet.twoSided ? '☑' : '☐'} ${COPY.twoSided}`}
                onPress={() => (sheet.twoSided ? (isEmptyFace(sheet.verso) ? setTwoSided(false) : setAsk('back')) : setTwoSided(true))}
              />
              {!last && <DeskButton label={`${COPY.next} ${face.sheet + 2}`} onPress={() => goTo(face.sheet + 1)} />}
              {(loose || last) && canAdd && <DeskButton label={COPY.more} strong onPress={addSheet} />}
              {sheets.length > 1 && (
                <DeskButton label={COPY.remove} onPress={() => (isEmptySheet(sheet) ? removeSheet() : setAsk('remove'))} />
              )}
            </View>
          )}
          {last && !canAdd && sheets.length >= maxSheets && <Text style={styles.ask}>{COPY.full}</Text>}
        </>
      )}
    </View>
  );
}

/** A sheet lying on the loose desk under the top one: the side that is up, where it was put. */
function LooseSheet({
  index,
  faces,
  shadow,
  side,
  chosen,
  placements,
  area,
  width,
  height,
}: {
  index: number;
  faces: SheetFaces;
  shadow: ReturnType<typeof useShadow>;
  side: Side;
  /** Picked with Shift + click: a thin warm line round it. */
  chosen: boolean;
  placements: SharedValue<Placement[]>;
  area: { width: number; height: number };
  width: number;
  height: number;
}) {
  const transform = useDerivedValue(() => {
    const pl = placements.value[index] ?? HOME;
    return [
      { translateX: area.width / 2 + pl.x },
      { translateY: area.height / 2 + pl.y },
      { rotate: pl.rot },
      { translateX: -width / 2 },
      { translateY: -height / 2 },
    ];
  });
  return (
    <Group transform={transform}>
      {shadow && <Image image={shadow.image} {...shadow.rect} fit="fill" />}
      <Picture picture={side === 'verso' ? faces.verso : faces.recto} />
      {chosen && <Rect x={1} y={1} width={width - 2} height={height - 2} color={CHOSEN} style="stroke" strokeWidth={2} />}
    </Group>
  );
}

/**
 * The sheet turning over (a page of a book, the other way when coming back), or
 * sliding aside to show the next one beneath (coming back: the previous one slides
 * back on top).
 */
function TurnOverlay({
  from,
  to,
  kind,
  dir,
  grip,
  fade,
  free,
  p,
  width,
  height,
}: {
  /** Nothing to draw between turns. */
  from: SkPicture | null;
  to: SkPicture | null;
  kind: 'flip' | 'slide';
  dir: 1 | -1;
  grip: SharedValue<Grip>;
  fade: boolean;
  /** A steep free turn (the loose desk, top over bottom): the sheet spins through every angle on its way over. */
  free: boolean;
  p: SharedValue<number>;
  width: number;
  height: number;
}) {
  // Seen from behind, the far face reads mirrored: draw it pre-mirrored so it lands upright.
  const back = useMemo(() => (to ? mirrorPicture(to, { width, height }) : null), [to, width, height]);
  const EMPTY = Skia.XYWHRect(0, 0, 0, 0);
  const full = Skia.XYWHRect(-2, -2, width + 4, height + 4);
  // Room around the sheet for a leaning turn. A free one spins the sheet through every angle:
  // at most ~1.03 of its half-diagonal across and ~1.13 up and down (nearer the eye, lifted),
  // found by sweeping this transform over every lean, spin and way; with a little to spare.
  const half = Math.hypot(width, height) / 2;
  const roomX = Math.ceil(free ? Math.max(width * 0.2, half * 1.06 - width / 2) : width * 0.2);
  const roomY = Math.ceil(free ? Math.max(width * 0.2, half * 1.16 - height / 2) : width * 0.2);
  const angle = useDerivedValue(() => p.value * Math.PI);
  // The sheet that moves: forward it is the one leaving; coming back, the previous one returning.
  const away = useDerivedValue(() => (dir === 1 ? p.value : 1 - p.value));
  const transform = useDerivedValue<Transforms3d>(() => {
    const { tilt, ux, uy, spin } = grip.value;
    if (kind === 'slide') {
      // Pushed the way the hand went (coming back, it arrives from the other side, moving the same way).
      const k = dir === 1 ? away.value : -away.value;
      return [{ translateX: width * 0.12 * ux * k }, { translateY: height * 0.05 * uy * k - height * 0.02 * away.value }, { rotate: 0.03 * ux * away.value }];
    }
    // Turned about an axis leaning by `tilt`, travelling a little with the hand. The twist
    // (tilt − 2·tilt·e) brings the far face down upright whatever the lean: at the end the
    // whole transform is the plain book-page mirror the back picture is drawn for.
    const lift = Math.sin(angle.value) * width * 0.05;
    const e = p.value * p.value * (3 - 2 * p.value);
    return [
      { translateX: ux * lift },
      { translateY: uy * lift },
      { perspective: PERSPECTIVE },
      { rotate: tilt - 2 * tilt * e },
      // Turned over the way the hand went (a free turn on the loose desk), else the turn's own way.
      { rotateY: -(spin ?? dir) * angle.value },
      { rotate: -tilt },
      { scale: 1 + 0.015 * Math.sin(angle.value) },
    ];
  });
  const frontClip = useDerivedValue(() => (kind === 'slide' || angle.value < Math.PI / 2 ? full : EMPTY));
  const backClip = useDerivedValue(() => (kind === 'flip' && angle.value >= Math.PI / 2 ? full : EMPTY));
  const shade = useDerivedValue(() => (kind === 'flip' ? 0.3 * Math.sin(angle.value) : 0));
  const present = useDerivedValue(() => 1 - away.value);
  const fadeOut = useDerivedValue(() => 1 - p.value);
  // A tick as the edge passes upright.
  useAnimatedReaction(
    () => kind === 'flip' && p.value > 0.5,
    (now, prev) => {
      if (now && prev === false) scheduleOnRN(feel.tick);
    },
  );

  if (fade) {
    // Reduce Motion: a crossfade, no turning.
    return (
      <View style={[StyleSheet.absoluteFill, styles.through]}>
        <Canvas style={{ width, height }}>
          {from && to && (
            <>
              <Picture picture={to} />
              <Group layer={<Paint opacity={fadeOut} />}>
                <Picture picture={from} />
              </Group>
            </>
          )}
        </Canvas>
      </View>
    );
  }
  return (
    // Room around the sheet: a leaning, travelling turn reaches past the sheet's own bounds.
    // Touches go through to the sheet beneath (a Canvas drops pointerEvents on the web: its wrapper keeps it).
    <View style={[{ position: 'absolute', left: -roomX, top: -roomY }, styles.through]}>
      <Canvas style={{ width: width + roomX * 2, height: height + roomY * 2 }}>
        {from && to && back && (
          <Group transform={[{ translateX: roomX }, { translateY: roomY }]}>
            {/* A slide: the sheet that stays put lies beneath the one that moves. */}
            {kind === 'slide' && <Picture picture={dir === 1 ? to : from} />}
            <Group origin={{ x: width / 2, y: height / 2 }} transform={transform}>
              <Group clip={frontClip} layer={kind === 'slide' ? <Paint opacity={present} /> : undefined}>
                <Picture picture={kind === 'slide' && dir === -1 ? to : from} />
              </Group>
              {kind === 'flip' && (
                <Group clip={backClip}>
                  <Picture picture={back} />
                </Group>
              )}
              <Rect x={0} y={0} width={width} height={height} color="#140c04" opacity={shade} />
            </Group>
          </Group>
        )}
      </Canvas>
    </View>
  );
}

/** A corner you can take: lifted a hair off the desk, its shadow says so. */
function CornerLift({ side, shown }: { side: 'left' | 'right'; shown: boolean }) {
  const x = side === 'right' ? CORNER.w : 0;
  return (
    // The wrapper lets touches through: a Canvas drops pointerEvents on the web.
    <View style={[{ position: 'absolute', bottom: 0, [side]: 0, opacity: shown ? 1 : 0 }, styles.through]}>
      <Canvas style={{ width: CORNER.w, height: CORNER.h }}>
        <Rect x={0} y={0} width={CORNER.w} height={CORNER.h}>
          <RadialGradient c={vec(x, CORNER.h)} r={30} colors={['rgba(30, 18, 8, 0.14)', 'rgba(30, 18, 8, 0)']} />
        </Rect>
      </Canvas>
    </View>
  );
}

/** The other sheets of the stack under this one: just their edges, never quite aligned. */
function StackEdges({ count, seed, width, height, paper }: { count: number; seed: number; width: number; height: number; paper: LetterLook['paper'] }) {
  const pad = 6;
  return (
    <Canvas style={{ position: 'absolute', left: -pad, top: -pad, width: width + pad * 2, height: height + pad * 2 }} pointerEvents="none">
      {Array.from({ length: Math.min(count, 2) }, (_, i) => {
        const j = sheetJitter(seed, i + 1);
        return (
          <Group key={i} transform={[{ translateX: pad + j.dx * (2 + i) }, { translateY: pad + j.dy * (2 + i) + 1.5 * (i + 1) }]}>
            <Rect x={0} y={0} width={width} height={height} color={paperEdgeColor(paper)} />
            <Rect x={0} y={0} width={width} height={height} color="rgba(30, 18, 8, 0.25)" style="stroke" strokeWidth={0.7} />
          </Group>
        );
      })}
    </Canvas>
  );
}

function DeskButton({ label, onPress, strong = false }: { label: string; onPress: () => void; strong?: boolean }) {
  return (
    <Pressable onPress={onPress} style={strong ? styles.strong : styles.quiet} accessibilityRole="button">
      <Text style={strong ? styles.strongText : styles.link}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 4 },
  where: { color: '#b9a88f', fontSize: 12, letterSpacing: 0.5 },
  ask: { color: '#e0c9a0', fontSize: 13 },
  quiet: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 10 },
  link: { color: '#b9a88f', fontSize: 13, textDecorationLine: 'underline' },
  strong: { minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 3, backgroundColor: '#efe2cc' },
  strongText: { color: '#2a211b', fontSize: 14 },
  edge: { position: 'absolute', top: 0, bottom: 0, width: EDGE },
  through: { pointerEvents: 'none' },
  chosen: { borderWidth: 2, borderColor: CHOSEN },
  // react-native-web passes the cursor through.
  choosing: { cursor: 'pointer' } as object,
  // react-native-web passes the cursor through.
  grab: { cursor: 'grab' } as object,
});
