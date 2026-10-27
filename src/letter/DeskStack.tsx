import { Canvas, Group, Paint, Picture, RadialGradient, Rect, Skia, useFont, vec, type SkPicture, type Transforms3d } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import {
  Easing,
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
import { HANDWRITING_FONTS } from '../theme/stationery';
import { bakeSheetFaces, paperEdgeColor, useGhostOf, type LetterLook } from './LetterSheet';
import { fontSizeFor, paperFor } from './sheet';
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
import { gripOf, type Grip } from './grip';
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
 */

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

const PERSPECTIVE = 1400;
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
  // Finished faces for the turn overlay: baked when a turn starts, not on every keystroke.
  const font = useFont(HANDWRITING_FONTS[look.font].file, fontSizeFor(paperFor(look.paper, width), width));
  const facesOf = (i: number, s: SheetContent | undefined = sheets[i]) =>
    font && s ? bakeSheetFaces(font, s, i, look, width, height, 0, 'tri', width) : null;
  const frozen = useMemo(
    () => (fixedTurn !== undefined && font ? bakeSheetFaces(font, sheet, face.sheet, look, width, height, 0, 'tri', width) : null),
    // QA frames only: bake once the font is in
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fixedTurn, font],
  );
  const reduceMotion = useReducedMotion();

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
  const begin = (turn: Turn | null) => {
    Keyboard.dismiss();
    setAsk(null);
    target.set(turn?.target ?? null);
    setTurning(turn);
  };
  const land = (commit: boolean, apply?: () => void) => {
    const to = target.get();
    target.set(null);
    if (to && commit) {
      apply?.();
      setFace(to);
    }
    setTurning(null);
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
  const forward = (): Turn | null =>
    face.side === 'recto' && sheet.twoSided ? flip() : face.sheet < sheets.length - 1 ? slide({ sheet: face.sheet + 1, side: 'recto' }) : null;
  const backward = (): Turn | null => {
    if (face.side === 'verso') return flip();
    if (face.sheet === 0) return null;
    // The page written just before this one: the back of the previous sheet, if it has one.
    const prev = sheets[face.sheet - 1];
    return slide({ sheet: face.sheet - 1, side: prev.twoSided ? 'verso' : 'recto' });
  };

  const turnOver = () => play(flip());
  const goTo = (i: number) => play(slide({ sheet: i, side: 'recto' }));
  const addSheet = () => {
    const blank = emptySheet(look.paper);
    play(slide({ sheet: sheets.length, side: 'recto' }, () => onSheets([...sheets, blank]), blank));
  };

  // The sheet's edges: the finger writes p (0 → 1 is the whole turn) and the grip.
  const travel = width * 0.8;
  const grabY = useSharedValue(0.5);
  const startDrag = (dir: 1 | -1) => begin(dir === 1 ? forward() : backward());
  const edge = (dir: 1 | -1) => ({
    // Not switched off while its own turn is under way: that would cancel the drag.
    enabled: fixedTurn === undefined && (dir === 1 ? canForward : canBackward),
    activeOffsetX: dir === 1 ? -6 : 6,
    // Mostly vertical still scrolls the desk; anything with a sideways start turns, at any angle after.
    failOffsetY: [-40, 40] as [number, number],
    onBegin: (e: { y: number }) => {
      grabY.set(Math.min(1, Math.max(0, e.y / height)));
    },
    onActivate: (e: { translationX: number; translationY: number }) => {
      p.set(0);
      grip.set(gripOf(dir, e.translationX, e.translationY, grabY.get()));
      scheduleOnRN(startDrag, dir);
    },
    onUpdate: (e: { translationX: number; translationY: number }) => {
      p.set(Math.min(1, Math.max(0, (-dir * e.translationX) / travel)));
      grip.set(gripOf(dir, e.translationX, e.translationY, grabY.get()));
    },
    onDeactivate: (e: { velocityX: number; canceled: boolean }) => {
      const v = (-dir * e.velocityX) / travel;
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
  });
  const canForward = (face.side === 'recto' && sheet.twoSided) || face.sheet < sheets.length - 1;
  const canBackward = face.side === 'verso' || face.sheet > 0;
  const forwardEdge = usePanGesture(edge(1));
  const backEdge = usePanGesture(edge(-1));

  const removeSheet = () => {
    const next = sheets.filter((_, i) => i !== face.sheet);
    onSheets(next);
    setFace({ sheet: Math.max(0, face.sheet - 1), side: 'recto' });
    setAsk(null);
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

  return (
    <View style={styles.root}>
      <View style={{ width, height }}>
        {sheets.length > 1 && <StackEdges count={sheets.length - 1} seed={look.seed} width={width} height={height} paper={look.paper} />}
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
            {canForward && (
              <>
                <CornerLift side="right" />
                <GestureDetector gesture={forwardEdge} touchAction="pan-y">
                  <View style={[styles.edge, { right: 0 }]} accessibilityLabel={COPY.cornerForward} />
                </GestureDetector>
              </>
            )}
            {canBackward && (
              <>
                <CornerLift side="left" />
                <GestureDetector gesture={backEdge} touchAction="pan-y">
                  <View style={[styles.edge, { left: 0 }]} accessibilityLabel={COPY.cornerBack} />
                </GestureDetector>
              </>
            )}
          </>
        )}
        {(turning || frozen) && (
          <TurnOverlay
            from={turning?.from ?? frozen!.recto}
            to={turning?.to ?? frozen!.verso}
            kind={turning?.kind ?? 'flip'}
            dir={turning?.dir ?? 1}
            grip={grip}
            fade={reduceMotion}
            p={p}
            width={width}
            height={height}
          />
        )}
      </View>

      <View style={styles.row}>
        {current.strokes.length > 0 && <DeskButton label={COPY.clearPen} onPress={() => setCurrent({ strokes: [] })} />}
      </View>
      {MULTI_SHEET && (
        <>
          <Text style={styles.where} accessibilityLiveRegion="polite">
            {COPY.sheet(face.sheet, sheets.length, face.side === 'verso')}
          </Text>
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
              {last && canAdd && <DeskButton label={COPY.more} strong onPress={addSheet} />}
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
  p,
  width,
  height,
}: {
  from: SkPicture;
  to: SkPicture;
  kind: 'flip' | 'slide';
  dir: 1 | -1;
  grip: SharedValue<Grip>;
  fade: boolean;
  p: SharedValue<number>;
  width: number;
  height: number;
}) {
  // Seen from behind, the far face reads mirrored: draw it pre-mirrored so it lands upright.
  const back = useMemo(() => mirrorPicture(to, { width, height }), [to, width, height]);
  const EMPTY = Skia.XYWHRect(0, 0, 0, 0);
  const full = Skia.XYWHRect(-2, -2, width + 4, height + 4);
  const room = Math.round(width * 0.2);
  const angle = useDerivedValue(() => p.value * Math.PI);
  // The sheet that moves: forward it is the one leaving; coming back, the previous one returning.
  const away = useDerivedValue(() => (dir === 1 ? p.value : 1 - p.value));
  const transform = useDerivedValue<Transforms3d>(() => {
    const { tilt, ux, uy } = grip.value;
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
      { rotateY: -dir * angle.value },
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
      <Canvas style={StyleSheet.flatten([StyleSheet.absoluteFill, { width, height }])} pointerEvents="none">
        <Picture picture={to} />
        <Group layer={<Paint opacity={fadeOut} />}>
          <Picture picture={from} />
        </Group>
      </Canvas>
    );
  }
  return (
    // Room around the sheet: a leaning, travelling turn reaches past the sheet's own bounds.
    <Canvas style={{ position: 'absolute', left: -room, top: -room, width: width + room * 2, height: height + room * 2 }} pointerEvents="none">
      <Group transform={[{ translateX: room }, { translateY: room }]}>
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
    </Canvas>
  );
}

/** A corner you can take: lifted a hair off the desk, its shadow says so. */
function CornerLift({ side }: { side: 'left' | 'right' }) {
  const x = side === 'right' ? CORNER.w : 0;
  return (
    <Canvas style={{ position: 'absolute', bottom: 0, [side]: 0, width: CORNER.w, height: CORNER.h }} pointerEvents="none">
      <Rect x={0} y={0} width={CORNER.w} height={CORNER.h}>
        <RadialGradient c={vec(x, CORNER.h)} r={30} colors={['rgba(30, 18, 8, 0.14)', 'rgba(30, 18, 8, 0)']} />
      </Rect>
    </Canvas>
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
});
