import { Canvas, Group, Paint, Path, Picture } from '@shopify/react-native-skia';
import { Link } from 'expo-router';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Choice } from '@/components/Choice';
import { Desk } from '@/components/Desk';
import { setDraft } from '@/lib/draft';
import { useLabParams } from '@/lib/params';
import { useLetterPicture, type LetterLook } from '@/letter/LetterSheet';
import { writingArea } from '@/letter/renderLetter';
import { fontSizeFor, paperFor, useSheetSize } from '@/letter/sheet';
import { pressureFromSpeed, strokeToPath, type Stroke } from '@/letter/strokes';
import { HANDWRITING_FONTS, INKS } from '@/theme/stationery';

/**
 * Spike: can you write naturally on the sheet?
 * Keyboard: a transparent native TextInput lies exactly on the paper, in the same
 * font and on the same grid (so RU/FR keyboards, autocorrect and dictation just work).
 * When you stop writing it crossfades into the jittered, inked Skia render.
 * Pen: finger/stylus strokes via perfect-freehand, for the signature, P.S. and doodles.
 */

type Mode = 'keyboard' | 'pen';
const MODES = [
  { key: 'keyboard', label: 'Клавиатура' },
  { key: 'pen', label: 'Перо' },
] as const;

export default function TypingLab() {
  const q = useLabParams();
  const size = useSheetSize();
  const look: LetterLook = { paper: 'grid', ink: 'blueBlack', font: 'badScript', seed: q.seed ?? 7 };
  const paper = paperFor(look.paper, size.width);
  const fontSize = fontSizeFor(paper, size.width);
  const area = writingArea(paper, size, fontSize);

  const [mode, setMode] = useState<Mode>('keyboard');
  const [text, setText] = useState('Привет! Пишу тебе прямо на бумаге.\nÇa marche aussi en français.');
  const [editing, setEditing] = useState(false);
  const [{ strokes, live }, pen$] = useReducer(penReducer, { strokes: [], live: [] });
  // Only what you actually wrote becomes the draft the postbox sends (not the demo line).
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched || strokes.length) setDraft({ text: touched ? text : '', strokes, sheetWidth: size.width, look });
    // look is rebuilt each render from stable values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touched, text, strokes, size.width]);

  const { picture: paperPic } = useLetterPicture('', look, size.width, size.height, 0, 'paper');
  const { picture: inkPic, overflow } = useLetterPicture(text, look, size.width, size.height, 0, 'ink');

  // Ink layer fades out while typing (the native text is visible instead) and back in after.
  const inkOpacity = useSharedValue(1);
  const inkOpacityDerived = useDerivedValue(() => inkOpacity.value);
  const onFocus = () => {
    setEditing(true);
    inkOpacity.set(withTiming(0, { duration: 120 }));
  };
  const onBlur = () => {
    setEditing(false);
    inkOpacity.set(withTiming(1, { duration: 700 }));
  };

  const addPoint = (x: number, y: number, pressure: number, first: boolean) =>
    pen$({ type: 'point', x, y, pressure, first, now: Date.now() });
  const endStroke = () => pen$({ type: 'end' });

  const pen = usePanGesture({
    enabled: mode === 'pen',
    minDistance: 0,
    onBegin: (e) => scheduleOnRN(addPoint, e.x, e.y, e.stylusData?.pressure ?? 0, true),
    onUpdate: (e) => scheduleOnRN(addPoint, e.x, e.y, e.stylusData?.pressure ?? 0, false),
    onFinalize: () => scheduleOnRN(endStroke),
  });

  const penSize = fontSize * 0.16;
  const strokePaths = useMemo(() => strokes.map((s) => strokeToPath(s, penSize)), [strokes, penSize]);
  const livePath = live.length > 1 ? strokeToPath(live, penSize) : null;

  return (
    <Desk title="Письмо" hint="Type with any keyboard (RU/FR, dictation). Tap outside to let the ink dry. Switch to the pen to sign.">
      <Choice options={MODES} value={mode} onChange={setMode} />
      <View style={{ width: size.width, height: size.height }}>
        <GestureDetector gesture={pen}>
          <Canvas style={StyleSheet.absoluteFill}>
            {paperPic && <Picture picture={paperPic} />}
            {/* pictures ignore group opacity, so fade through a layer paint */}
            <Group layer={<Paint opacity={inkOpacityDerived} />}>{inkPic && <Picture picture={inkPic} />}</Group>
            <Group blendMode="multiply" opacity={0.93}>
              {strokePaths.map((p, i) => (
                <Path key={i} path={p} color={INKS[look.ink].color} />
              ))}
              {/* wet ink: darker and glossier until the stroke ends */}
              {livePath && <Path path={livePath} color="#121a33" />}
            </Group>
          </Canvas>
        </GestureDetector>
        <TextInput
          multiline
          value={text}
          onChangeText={(v) => {
            setText(v);
            setTouched(true);
          }}
          onFocus={onFocus}
          onBlur={onBlur}
          editable={mode === 'keyboard'}
          pointerEvents={mode === 'keyboard' ? 'auto' : 'none'}
          autoCorrect
          scrollEnabled={false}
          selectionColor={INKS[look.ink].color}
          style={[
            styles.input,
            {
              left: area.left,
              width: area.maxWidth,
              top: 0,
              height: size.height,
              paddingTop: area.top - area.lineHeight * 0.74,
              fontFamily: HANDWRITING_FONTS[look.font].family,
              fontSize,
              lineHeight: area.lineHeight,
              color: editing ? INKS[look.ink].color : 'transparent',
            },
          ]}
        />
      </View>
      {overflow && <Text style={styles.warn}>Лист закончился — the rest won’t fit on this sheet.</Text>}
      {strokes.length > 0 && (
        <Pressable onPress={() => pen$({ type: 'clear' })}>
          <Text style={styles.link}>Стереть перо</Text>
        </Pressable>
      )}
      {(touched || strokes.length > 0) && (
        <Link dismissTo href="/lab/post" style={styles.link}>
          Отнести на почту →
        </Link>
      )}
    </Desk>
  );
}

type PenState = { strokes: Stroke[]; live: Stroke };
type PenAction =
  | { type: 'point'; x: number; y: number; pressure: number; first: boolean; now: number }
  | { type: 'end' }
  | { type: 'clear' };

// Live points carry absolute time; stored strokes are relative to their first point.
function penReducer(state: PenState, a: PenAction): PenState {
  switch (a.type) {
    case 'point': {
      const base = a.first ? [] : state.live;
      const prev = base[base.length - 1];
      return { ...state, live: [...base, [a.x, a.y, pressureFromSpeed(prev, a.x, a.y, a.now, a.pressure), a.now]] };
    }
    case 'end': {
      if (state.live.length < 2) return { ...state, live: [] };
      const t0 = state.live[0][3];
      const stroke: Stroke = state.live.map(([x, y, p, t]) => [x, y, p, t - t0]);
      return { strokes: [...state.strokes, stroke], live: [] };
    }
    case 'clear':
      return { strokes: [], live: [] };
  }
}

const styles = StyleSheet.create({
  input: { position: 'absolute', textAlignVertical: 'top', padding: 0, paddingHorizontal: 0 },
  warn: { color: '#e0a0a0', fontSize: 13 },
  link: { color: '#b9a88f', fontSize: 13, textDecorationLine: 'underline' },
});
