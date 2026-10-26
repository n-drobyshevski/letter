import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Choice } from '@/components/Choice';
import { Desk } from '@/components/Desk';
import { setDraft } from '@/lib/draft';
import { useLabParams } from '@/lib/params';
import type { LetterLook } from '@/letter/LetterSheet';
import { useSheetSize } from '@/letter/sheet';
import type { Stroke } from '@/letter/strokes';
import { WritingDesk, type WritingMode } from '@/letter/WritingDesk';

/** Spike: can you write naturally on the sheet? (The sheet itself is WritingDesk.) */

const MODES = [
  { key: 'keyboard', label: 'Клавиатура' },
  { key: 'pen', label: 'Перо' },
] as const;

export default function TypingLab() {
  const q = useLabParams();
  const size = useSheetSize();
  const look: LetterLook = { paper: 'grid', ink: 'blueBlack', font: 'badScript', seed: q.seed ?? 7 };

  const [mode, setMode] = useState<WritingMode>('keyboard');
  const [text, setText] = useState('Привет! Пишу тебе прямо на бумаге.\nÇa marche aussi en français.');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  // Only what you actually wrote becomes the draft the postbox sends (not the demo line).
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched || strokes.length) setDraft({ text: touched ? text : '', strokes, sheetWidth: size.width, look });
    // look is rebuilt each render from stable values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touched, text, strokes, size.width]);

  return (
    <Desk title="Письмо" hint="Type with any keyboard (RU/FR, dictation). Tap outside to let the ink dry. Switch to the pen to sign.">
      <Choice options={MODES} value={mode} onChange={setMode} />
      <WritingDesk
        look={look}
        width={size.width}
        height={size.height}
        mode={mode}
        text={text}
        onText={(v) => {
          setText(v);
          setTouched(true);
        }}
        strokes={strokes}
        onStrokes={setStrokes}
      />
      {strokes.length > 0 && (
        <Pressable onPress={() => setStrokes([])}>
          <Text style={styles.link}>Стереть перо</Text>
        </Pressable>
      )}
      {(touched || strokes.length > 0) && (
        <Link href="/fold" style={styles.link}>
          Сложить письмо →
        </Link>
      )}
    </Desk>
  );
}

const styles = StyleSheet.create({
  link: { color: '#b9a88f', fontSize: 13, textDecorationLine: 'underline' },
});
