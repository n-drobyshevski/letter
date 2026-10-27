import { Link } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Choice } from '@/components/Choice';
import { getDraft, setDraft, useDraft, writtenSheets } from '@/lib/draft';
import { useCouple, useSession } from '@/lib/mail';
import { useLabParams } from '@/lib/params';
import { getStationeryPick, setStationeryPick, useStationeryPick } from '@/lib/stationeryPick';
import { DeskScene } from '@/letter/desk/DeskScene';
import { DESK_COPY } from '@/letter/desk/deskCopy';
import { useDeskLayout } from '@/letter/desk/layout';
import { applyPick, withoutDemo } from '@/letter/desk/pick';
import { DRAWERS, deskSeed, type DeskItem } from '@/letter/desk/types';
import { DeskStack } from '@/letter/DeskStack';
import type { LetterLook } from '@/letter/LetterSheet';
import { sampleSheets } from '@/letter/samples';
import { defaultTwoSided, emptyFace, isEmptySheet, maxSheetsFor, rescaleStrokes, type SheetContent } from '@/letter/stack';
import type { Lang } from '@/letter/tracking/copy';
import type { WritingMode } from '@/letter/WritingDesk';
import { FONT_KEYS, INK_KINDS, SHEET_PAPERS, type SheetPaper } from '@/theme/kinds';
import type { Country } from '@/theme/stationery';

/**
 * /write: the sheet on the writing desk (the sheet itself is WritingDesk, the stack DeskStack, the desk
 * and its drawers DeskScene). What you take from the drawers sets the paper, the hand and the ink while
 * the letter is blank, and the envelope /seal starts from.
 */

const COPY: Record<Lang, { title: string; modes: readonly { key: WritingMode; label: string }[]; fold: string }> = {
  ru: {
    title: 'Письмо',
    modes: [
      { key: 'keyboard', label: 'Клавиатура' },
      { key: 'pen', label: 'Перо' },
    ],
    fold: 'Сложить письмо →',
  },
  fr: {
    title: 'Lettre',
    modes: [
      { key: 'keyboard', label: 'Clavier' },
      { key: 'pen', label: 'Plume' },
    ],
    fold: 'Plier la lettre →',
  },
};

const DEMO = 'Привет! Пишу тебе прямо на бумаге.\nÇa marche aussi en français.';
// A fresh letter's seed: the recipient lays the words out with it too.
const newSeed = () => Math.floor(Math.random() * 2 ** 31);
const validQ = <T extends string>(v: string | undefined, list: readonly T[]) => (list.includes(v as T) ? (v as T) : undefined);

export default function TypingLab() {
  const q = useLabParams();
  const layout = useDeskLayout();
  const size = layout.sheet;
  // The writer's desk: their locale, and their country's furniture (a Paris time zone is the French desk).
  const session = useSession();
  const { couple } = useCouple(session?.user.id);
  const qCountry: Country = q.country === 'fr' ? 'fr' : 'ru';
  const country: Country = couple ? (couple.me.tz === 'Europe/Paris' ? 'fr' : 'ru') : qCountry;
  const lang: Lang = couple?.me.locale ?? qCountry;
  const copy = COPY[lang];

  // Back from /fold: the same letter, as you left it. A new one starts from what was last taken from the drawers.
  const [saved] = useState(getDraft);
  const [look, setLook] = useState<LetterLook>(() => {
    if (saved) return saved.look;
    const pick = getStationeryPick();
    return {
      paper: validQ(q.paper, SHEET_PAPERS) ?? pick.paper,
      ink: validQ(q.ink, INK_KINDS) ?? pick.ink,
      font: validQ(q.font, FONT_KEYS) ?? pick.font,
      seed: q.seed ?? newSeed(),
    };
  });
  const envelope = useStationeryPick().envelope;

  const [mode, setMode] = useState<WritingMode>('keyboard');
  const [sheets, setSheets] = useState<SheetContent[]>(() => {
    // Pen strokes are in pixels of the sheet they were drawn on: follow the sheet if the window changed.
    if (saved) return rescaleStrokes(saved.sheets, size.width / saved.sheetWidth);
    return q.sheets
      ? sampleSheets(q.sheets)
      : [{ recto: { text: DEMO, strokes: [] }, verso: emptyFace(), twoSided: defaultTwoSided(look.paper) }];
  });
  // Only what you actually wrote becomes the draft the postbox sends (not the demo line; a lab sample stack never).
  const fixture = !saved && !!q.sheets;
  const [touched, setTouched] = useState(!!saved);
  const [demo, setDemo] = useState(!saved && !q.sheets);
  // The sheet follows the window (on a laptop its height too): strokes follow it in the same render, so
  // the draft never pairs the new width with strokes drawn at the old one.
  const [drawnAt, setDrawnAt] = useState(size.width);
  if (drawnAt !== size.width) {
    setDrawnAt(size.width);
    setSheets((s) => rescaleStrokes(s, size.width / drawnAt));
  }
  // What the letter holds without the demo line: the draft, and whether the drawers still re-paper it.
  const written = useMemo(() => withoutDemo(sheets, demo), [sheets, demo]);
  const blank = written.every(isEmptySheet);
  // The draft as /fold and /seal left it (this screen stays mounted under them): its fold, its seal.
  const draft = useDraft();
  const fold = draft?.fold;
  const maxSheets = maxSheetsFor(fold);
  useEffect(() => {
    if (!touched || fixture) return;
    const prev = getDraft();
    const folded = prev?.fold;
    const next = { sheets: written, sheetWidth: size.width, look };
    // More sheets than that fold takes (two, in four): it has to be folded again.
    const fits = folded && writtenSheets(next).length <= maxSheetsFor(folded);
    // Coming back to the desk without changing a word (or the look) keeps the letter sealed; any edit unseals it.
    const unchanged = fits && prev.sheets === written && prev.sheetWidth === size.width && prev.look === look;
    setDraft(written.every(isEmptySheet) ? null : { ...next, fold: fits ? folded : undefined, envelope: unchanged ? prev.envelope : undefined });
  }, [touched, fixture, written, size.width, look]);

  // The desk: what DeskStack reports (keyboard on the sheet, a sheet turning), and a bump to lay the next sheet.
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addSheetKey, setAddSheetKey] = useState(0);

  const onPick = (item: DeskItem, confirmed?: boolean) => {
    const out = applyPick({ blank, look, sheets, maxSheets, envelope, sealed: !!getDraft()?.envelope }, item, confirmed);
    if (out.kind !== 'apply') return out;
    if (out.look) setLook(out.look);
    if (out.sheets) setSheets(out.sheets);
    if (out.addSheet) setAddSheetKey((k) => k + 1);
    if (out.unseal) {
      const d = getDraft();
      if (d) setDraft({ ...d, envelope: undefined });
    }
    // Remembered for the next letter (and for /seal): only what was applied.
    setStationeryPick({
      paper: out.look?.paper as SheetPaper | undefined,
      ink: out.look?.ink,
      font: out.look?.font,
      envelope: out.envelope,
    });
    return out;
  };

  const fixedDrawer = validQ(q.drawer, DRAWERS);
  return (
    <DeskScene
      lang={lang}
      country={country}
      seed={deskSeed(country)}
      layout={layout}
      title={copy.title}
      hint={DESK_COPY[lang].hint}
      header={<Choice options={copy.modes} value={mode} onChange={setMode} />}
      sheet={
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
          maxSheets={maxSheets}
          initialFace={q.face}
          fixedTurn={q.turn}
          fixedTilt={q.tilt}
          onEditing={setEditing}
          onBusy={setBusy}
          addSheetKey={addSheetKey}
          controlsGap={layout.pad.marginY - 6}
        />
      }
      look={look}
      envelope={envelope}
      locked={{ paper: !blank, pen: !blank, ink: !blank }}
      editing={editing}
      busy={busy}
      onPick={onPick}
      // QA frames: a frozen drawer, a lifted item, the keyboard up, Reduce Motion. Any seed counts as a
      // QA frame too (t: 0 freezes nothing), so the first-visit breath never lands in a screenshot.
      fixed={{
        drawer: fixedDrawer,
        t: q.dt ?? (q.seed !== undefined ? 0 : undefined),
        item: q.item,
        kb: q.kb === 1 || undefined,
        rm: q.rm === 1 || undefined,
      }}
    >
      {touched && !fixture && (
        <Link href="/fold" style={styles.link}>
          {copy.fold}
        </Link>
      )}
    </DeskScene>
  );
}

const styles = StyleSheet.create({
  link: { color: '#b9a88f', fontSize: 13, textDecorationLine: 'underline' },
});
