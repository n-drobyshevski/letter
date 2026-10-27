import { Canvas, Group, Paint, Picture, Rect, Skia, type SkPicture, type Transforms3d } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { paperEdgeColor, useGhostOf, useSheetFaces, type LetterLook } from './LetterSheet';
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
import type { Stroke } from './strokes';
import { WritingDesk, type WritingMode } from './WritingDesk';

/**
 * The writing desk with a small stack of sheets: write on the front, turn the
 * sheet over like a book page to write on the back (if this sheet is two-sided),
 * take another sheet. Each face keeps its own text and strokes; nothing flows.
 * The turn is drawn on a Skia overlay with both faces baked: a native TextInput
 * can't turn in 3D, so the desk under it waits, hidden, and changes face at once.
 */

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
};

export function DeskStack({ look, width, height, mode, sheets, onSheets, maxSheets = MAX_SHEETS, placeholder, initialFace = 0, fixedTurn }: Props) {
  const [face, setFace] = useState<FaceRef>(() => {
    const sheet = Math.min(sheets.length - 1, Math.floor(initialFace / 2));
    return { sheet, side: initialFace % 2 && sheets[sheet]?.twoSided ? 'verso' : 'recto' };
  });
  const [ask, setAsk] = useState<'remove' | 'back' | null>(null);
  const [turning, setTurning] = useState<{ from: SkPicture; to?: SkPicture; kind: 'flip' | 'slide' } | null>(null);
  const sheet = sheets[face.sheet] ?? emptySheet(look.paper);
  const current = faceOf(sheets, face);
  const other: FaceRef = { sheet: face.sheet, side: face.side === 'recto' ? 'verso' : 'recto' };
  const ghost = useGhostOf(faceOf(sheets, other), other, look, width, height, width);
  // Both faces of this sheet, finished, for the turn overlay.
  const faces = useSheetFaces(sheet, face.sheet, look, width, height, 0, 'tri', width);
  const reduceMotion = useReducedMotion();

  const p = useSharedValue(fixedTurn ?? 0);
  useEffect(() => {
    if (fixedTurn !== undefined) p.set(fixedTurn);
  }, [fixedTurn, p]);

  const setCurrent = (next: { text?: string; strokes?: Stroke[] }) => onSheets(withFace(sheets, face, { ...current, ...next }));

  /** Turns `from` over to `to`, or slides `from` aside off the desk (already on the new face). */
  const animate = (kind: 'flip' | 'slide', from: SkPicture | undefined, to: SkPicture | undefined, go: () => void) => {
    Keyboard.dismiss();
    setAsk(null);
    if (!from || (kind === 'flip' && !to)) return go();
    setTurning({ from, to, kind });
    go();
    p.set(0);
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(setTurning, null);
    };
    p.set(
      reduceMotion || kind === 'slide'
        ? withTiming(1, { duration: reduceMotion ? 150 : 320, easing: Easing.out(Easing.cubic) }, done)
        : withSpring(1, { damping: 20, stiffness: 150, mass: 0.9 }, done),
    );
  };

  const turnOver = () => {
    if (!faces) return;
    const toVerso = face.side === 'recto';
    animate('flip', toVerso ? faces.recto : faces.verso, toVerso ? faces.verso : faces.recto, () => setFace(other));
  };
  const goTo = (i: number) => animate('slide', faces?.[face.side], undefined, () => setFace({ sheet: i, side: 'recto' }));
  const addSheet = () =>
    animate('slide', faces?.[face.side], undefined, () => {
      onSheets([...sheets, emptySheet(look.paper)]);
      setFace({ sheet: sheets.length, side: 'recto' });
    });
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
        <View style={{ opacity: turning?.kind === 'flip' || fixedTurn !== undefined ? 0 : 1 }}>
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
        {(turning || (fixedTurn !== undefined && faces)) && (
          <TurnOverlay
            from={turning?.from ?? faces!.recto}
            to={turning?.to ?? faces!.verso}
            kind={turning?.kind ?? 'flip'}
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

/** The sheet turning over (a page of a book) or sliding aside to show the next one. */
function TurnOverlay({
  from,
  to,
  kind,
  fade,
  p,
  width,
  height,
}: {
  from: SkPicture;
  to?: SkPicture;
  kind: 'flip' | 'slide';
  fade: boolean;
  p: SharedValue<number>;
  width: number;
  height: number;
}) {
  // Seen from behind, the far face reads mirrored: draw it pre-mirrored so it lands upright.
  const back = to ? mirrorPicture(to, { width, height }) : null;
  const EMPTY = Skia.XYWHRect(0, 0, 0, 0);
  const full = Skia.XYWHRect(-2, -2, width + 4, height + 4);
  const angle = useDerivedValue(() => p.value * Math.PI);
  const transform = useDerivedValue<Transforms3d>(() =>
    kind === 'slide'
      ? [{ translateX: -width * 0.12 * p.value }, { translateY: -height * 0.03 * p.value }, { rotate: -0.03 * p.value }]
      : [{ perspective: PERSPECTIVE }, { rotateY: -angle.value }, { scale: 1 + 0.015 * Math.sin(angle.value) }],
  );
  const frontClip = useDerivedValue(() => (kind === 'slide' || angle.value < Math.PI / 2 ? full : EMPTY));
  const backClip = useDerivedValue(() => (kind === 'flip' && angle.value >= Math.PI / 2 ? full : EMPTY));
  const shade = useDerivedValue(() => (kind === 'flip' ? 0.3 * Math.sin(angle.value) : 0));
  const leaving = useDerivedValue(() => (kind === 'slide' ? 1 - p.value : 1));
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
        {to && <Picture picture={to} />}
        <Group layer={<Paint opacity={fadeOut} />}>
          <Picture picture={from} />
        </Group>
      </Canvas>
    );
  }
  return (
    <Canvas style={StyleSheet.flatten([StyleSheet.absoluteFill, { width, height }])} pointerEvents="none">
      <Group origin={{ x: width / 2, y: height / 2 }} transform={transform}>
        <Group clip={frontClip} layer={kind === 'slide' ? <Paint opacity={leaving} /> : undefined}>
          <Picture picture={from} />
        </Group>
        {back && (
          <Group clip={backClip}>
            <Picture picture={back} />
          </Group>
        )}
        <Rect x={0} y={0} width={width} height={height} color="#140c04" opacity={shade} />
      </Group>
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
});
