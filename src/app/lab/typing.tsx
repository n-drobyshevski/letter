import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Choice } from '@/components/Choice';
import { Desk } from '@/components/Desk';
import { getDraft, setDraft } from '@/lib/draft';
import { useLabParams } from '@/lib/params';
import { DeskStack } from '@/letter/DeskStack';
import type { LetterLook } from '@/letter/LetterSheet';
import { sampleSheets } from '@/letter/samples';
import { useSheetSize } from '@/letter/sheet';
import { defaultTwoSided, emptyFace, isEmptySheet, maxSheetsFor, type SheetContent } from '@/letter/stack';
import type { WritingMode } from '@/letter/WritingDesk';
import type { PaperKind } from '@/theme/stationery';

/** Spike: can you write naturally on the sheet? (The sheet itself is WritingDesk, the stack DeskStack.) */

const MODES = [
  { key: 'keyboard', label: 'Клавиатура' },
  { key: 'pen', label: 'Перо' },
] as const;

const DEMO = 'Привет! Пишу тебе прямо на бумаге.\nÇa marche aussi en français.';
const PAPERS: PaperKind[] = ['grid', 'cotton'];
// A fresh letter's seed: the recipient lays the words out with it too.
const newSeed = () => Math.floor(Math.random() * 2 ** 31);

export default function TypingLab() {
  const q = useLabParams();
  const size = useSheetSize();
  // Back from /fold: the same letter, as you left it.
  const [saved] = useState(getDraft);
  const paper = saved?.look.paper ?? (PAPERS.includes(q.paper as PaperKind) ? (q.paper as PaperKind) : 'grid');
  const [look] = useState<LetterLook>(() => saved?.look ?? { paper, ink: 'blueBlack', font: 'badScript', seed: q.seed ?? newSeed() });

  const [mode, setMode] = useState<WritingMode>('keyboard');
  const [sheets, setSheets] = useState<SheetContent[]>(
    () =>
      saved?.sheets ??
      (q.sheets ? sampleSheets(q.sheets) : [{ recto: { text: DEMO, strokes: [] }, verso: emptyFace(), twoSided: defaultTwoSided(paper) }]),
  );
  // Only what you actually wrote becomes the draft the postbox sends (not the demo line, not lab samples).
  const [touched, setTouched] = useState(!!saved);
  const [demo, setDemo] = useState(!saved && !q.sheets);
  useEffect(() => {
    if (!touched) return;
    const written = demo ? sheets.map((s, i) => (i === 0 ? { ...s, recto: { ...s.recto, text: '' } } : s)) : sheets;
    setDraft(written.every(isEmptySheet) ? null : { sheets: written, sheetWidth: size.width, look, fold: saved?.fold });
  }, [touched, demo, sheets, size.width, look, saved?.fold]);

  return (
    <Desk title="Письмо" hint="Type with any keyboard (RU/FR, dictation). Tap outside to let the ink dry. Switch to the pen to sign. Turn the sheet over to write on the back.">
      <Choice options={MODES} value={mode} onChange={setMode} />
      <DeskStack
        look={look}
        width={size.width}
        height={size.height}
        mode={mode}
        sheets={sheets}
        onSheets={(next) => {
          if (demo && next[0]?.recto.text !== sheets[0]?.recto.text) setDemo(false);
          setSheets(next);
          setTouched(true);
        }}
        maxSheets={maxSheetsFor(saved?.fold)}
        initialFace={q.face}
        fixedTurn={q.turn}
      />
      {touched && (
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
