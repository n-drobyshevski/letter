import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Choice } from '@/components/Choice';
import { Desk } from '@/components/Desk';
import { getDraft, setDraft, useDraft, writtenSheets } from '@/lib/draft';
import { useLabParams } from '@/lib/params';
import { DeskStack } from '@/letter/DeskStack';
import type { LetterLook } from '@/letter/LetterSheet';
import { sampleSheets } from '@/letter/samples';
import { useSheetSize } from '@/letter/sheet';
import { defaultTwoSided, emptyFace, isEmptySheet, maxSheetsFor, type SheetContent } from '@/letter/stack';
import type { StrokePoint } from '@/letter/strokes';
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
  const [sheets, setSheets] = useState<SheetContent[]>(() => {
    // Pen strokes are in pixels of the sheet they were drawn on: follow the sheet if the window changed.
    if (saved) return saved.sheetWidth === size.width ? saved.sheets : rescale(saved.sheets, size.width / saved.sheetWidth);
    return q.sheets ? sampleSheets(q.sheets) : [{ recto: { text: DEMO, strokes: [] }, verso: emptyFace(), twoSided: defaultTwoSided(paper) }];
  });
  // Only what you actually wrote becomes the draft the postbox sends (not the demo line; a lab sample stack never).
  const fixture = !saved && !!q.sheets;
  const [touched, setTouched] = useState(!!saved);
  const [demo, setDemo] = useState(!saved && !q.sheets);
  // The fold chosen at /fold since (this screen stays mounted under it).
  const fold = useDraft()?.fold;
  useEffect(() => {
    if (!touched || fixture) return;
    const written = demo ? sheets.map((s, i) => (i === 0 ? { ...s, recto: { ...s.recto, text: '' } } : s)) : sheets;
    const prev = getDraft();
    const folded = prev?.fold;
    const draft = { sheets: written, sheetWidth: size.width, look };
    // More sheets than that fold takes (two, in four): it has to be folded again.
    const fits = folded && writtenSheets(draft).length <= maxSheetsFor(folded);
    // Coming back to the desk without changing a word keeps the letter sealed; any edit unseals it.
    const unchanged = fits && prev.sheets === written && prev.sheetWidth === size.width;
    setDraft(written.every(isEmptySheet) ? null : { ...draft, fold: fits ? folded : undefined, envelope: unchanged ? prev.envelope : undefined });
  }, [touched, fixture, demo, sheets, size.width, look]);

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
        maxSheets={maxSheetsFor(fold)}
        initialFace={q.face}
        fixedTurn={q.turn}
        fixedTilt={q.tilt}
      />
      {touched && !fixture && (
        <Link href="/fold" style={styles.link}>
          Сложить письмо →
        </Link>
      )}
    </Desk>
  );
}

const rescale = (sheets: SheetContent[], k: number): SheetContent[] => {
  const face = (f: SheetContent['recto']) => ({ ...f, strokes: f.strokes.map((s) => s.map(([x, y, p, t]): StrokePoint => [x * k, y * k, p, t])) });
  return sheets.map((s) => ({ ...s, recto: face(s.recto), verso: face(s.verso) }));
};

const styles = StyleSheet.create({
  link: { color: '#b9a88f', fontSize: 13, textDecorationLine: 'underline' },
});
