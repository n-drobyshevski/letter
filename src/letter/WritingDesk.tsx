import { Canvas, Group, Paint, Path, Picture, type SkImage } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { HANDWRITING_FONTS, INKS } from '../theme/stationery';
import { useLetterPicture, type LetterLook } from './LetterSheet';
import { writingArea } from './renderLetter';
import { fontSizeFor, paperFor } from './sheet';
import type { FaceRef } from './stack';
import { pressureFromSpeed, strokeToPath, type Stroke } from './strokes';

/**
 * The sheet you write on.
 * Keyboard: a transparent native TextInput lies exactly on the paper, in the same
 * font and on the same grid (so RU/FR keyboards, autocorrect and dictation just work).
 * When you stop writing it crossfades into the jittered, inked Skia render.
 * Pen: finger/stylus strokes via perfect-freehand, for the signature, P.S. and doodles.
 * Text and strokes belong to the caller; strokes are in pixels of this sheet.
 * One face at a time: on the verso the paper (and its margin) is mirrored, and the
 * recto's ink shows through as `ghost`.
 */
export type WritingMode = 'keyboard' | 'pen';

type Props = {
  look: LetterLook;
  width: number;
  height: number;
  mode: WritingMode;
  text: string;
  onText: (text: string) => void;
  strokes: Stroke[];
  onStrokes: (strokes: Stroke[]) => void;
  placeholder?: string;
  /** Which face of which sheet this is (sheet 1's recto by default). */
  face?: FaceRef;
  /** The other face's ink, seen through the paper (LetterSheet's useGhostOf). */
  ghost?: SkImage | null;
  /** What to say once the face is full. */
  overflowNote?: string;
};

export function WritingDesk({ look, width, height, mode, text, onText, strokes, onStrokes, placeholder, face, ghost, overflowNote }: Props) {
  const size = { width, height };
  const paper = paperFor(look.paper, width);
  const fontSize = fontSizeFor(paper, width);
  const area = writingArea(paper, size, fontSize, face?.side);

  const [editing, setEditing] = useState(false);
  // The stroke being drawn (absolute times until it ends): a ref, because gesture
  // callbacks may hold an older render's closure; state only to redraw it.
  const liveRef = useRef<Stroke>([]);
  const [live, setLive] = useState<Stroke>([]);
  const strokesRef = useRef(strokes);
  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  const { picture: paperPic } = useLetterPicture('', look, width, height, 0, 'paper', 'tri', { face, ghost });
  const { picture: inkPic, overflow } = useLetterPicture(text, look, width, height, 0, 'ink', 'tri', { face });

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

  const addPoint = (x: number, y: number, pressure: number, first: boolean) => {
    const now = Date.now();
    const base = first ? [] : liveRef.current;
    const prev = base[base.length - 1];
    liveRef.current = [...base, [x, y, pressureFromSpeed(prev, x, y, now, pressure), now]];
    setLive(liveRef.current);
  };
  // Stored strokes are relative to their first point.
  const endStroke = () => {
    const done = liveRef.current;
    if (done.length >= 2) {
      const t0 = done[0][3];
      onStrokes([...strokesRef.current, done.map(([x, y, p, t]) => [x, y, p, t - t0])]);
    }
    liveRef.current = [];
    setLive([]);
  };

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
    <>
      <View style={{ width, height }}>
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
          onChangeText={onText}
          onFocus={onFocus}
          onBlur={onBlur}
          editable={mode === 'keyboard'}
          pointerEvents={mode === 'keyboard' ? 'auto' : 'none'}
          autoCorrect
          scrollEnabled={false}
          placeholder={placeholder}
          placeholderTextColor="rgba(31, 43, 77, 0.35)"
          selectionColor={INKS[look.ink].color}
          style={[
            styles.input,
            {
              left: area.left,
              width: area.maxWidth,
              top: 0,
              height,
              paddingTop: area.top - area.lineHeight * 0.74,
              fontFamily: HANDWRITING_FONTS[look.font].family,
              fontSize,
              lineHeight: area.lineHeight,
              color: editing ? INKS[look.ink].color : 'transparent',
            },
          ]}
        />
      </View>
      {overflow && <Text style={styles.warn}>{overflowNote ?? 'Лист закончился — the rest won’t fit on this sheet.'}</Text>}
    </>
  );
}

const styles = StyleSheet.create({
  input: { position: 'absolute', textAlignVertical: 'top', padding: 0, paddingHorizontal: 0 },
  warn: { color: '#e0a0a0', fontSize: 13 },
});
