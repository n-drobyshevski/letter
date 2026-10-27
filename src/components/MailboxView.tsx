import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Desk } from '@/components/Desk';
import { useMotionPrefs } from '@/lib/useMotionPrefs';
import type { EnvelopeLook } from '@/letter/EnvelopeCeremony';
import { FoldableLetter } from '@/letter/FoldableLetter';
import { useStackPictures, type LetterLook } from '@/letter/LetterSheet';
import { sheetsOf, type MailLetter } from '@/letter/mailboxFromServer';
import { ReadingStack } from '@/letter/ReadingStack';
import { ReceivingCeremony, type OpenedBy, type ReceiveStage } from '@/letter/ReceivingCeremony';
import { SHEET_RATIO } from '@/letter/sheet';
import type { FaceRef } from '@/letter/stack';
import type { Country } from '@/theme/stationery';

export type MailboxPhase = 'mailbox' | 'unfold' | 'read' | 'empty';
type Phase = MailboxPhase;

/** UI copy follows the recipient (it is their mailbox), informal ты/tu. */
export const MAILBOX_COPY = {
  ru: {
    title: 'Почтовый ящик · кв. 47',
    hints: {
      0: 'В ящике что-то белеет. Открой ящик',
      1: 'Достань письмо',
      2: 'Переверни конверт',
      3: 'Сломай печать или проведи ножом вдоль сгиба',
      4: 'Достань письмо из конверта',
      5: 'Разверни',
    } as Record<ReceiveStage, string>,
    unfold: { tri: 'Разверни: потяни вниз', half: 'Разверни: подними верхнюю половину', quarter: 'Разверни: вправо, потом вверх' },
    from: (name: string, city: string, seal: boolean) => `От ${name}, ${city}${seal ? ' · печать сломана' : ''}`,
    next: (n: number) => `Следующее письмо · ещё ${n}`,
    empty: 'Пока пусто',
    replay: 'Открыть заново',
    advance: 'Дальше',
    count: (n: number) => `В ящике писем: ${n}`,
    shoebox: 'Прочитанные письма',
    transit: (n: number) => (n === 1 ? 'Одно письмо в пути к тебе →' : `Писем в пути к тебе: ${n} →`),
    back: '← к ящику',
    offline: 'без почты (лаб)',
    turnOver: 'Переверни лист',
    nextSheet: 'Следующий лист',
    prevFace: 'Назад',
    overleaf: 'На обороте ещё есть',
    where: (f: FaceRef, n: number) => `Лист ${f.sheet + 1} из ${n}${f.side === 'verso' ? ', оборот' : ''}`,
  },
  fr: {
    title: 'Boîte aux lettres',
    hints: {
      0: 'Quelque chose dépasse de ta boîte aux lettres. Ouvre-la',
      1: 'Sors la lettre',
      2: 'Retourne l’enveloppe',
      3: 'Brise le cachet ou fais glisser le coupe-papier le long du pli',
      4: 'Sors la lettre de l’enveloppe',
      5: 'Déplie-la',
    } as Record<ReceiveStage, string>,
    unfold: { tri: 'Déplie-la : tire vers le bas', half: 'Déplie-la : relève la moitié du haut', quarter: 'Déplie-la : vers la droite, puis vers le haut' },
    from: (name: string, city: string, seal: boolean) => `De ${name}, ${city}${seal ? ' · cachet brisé' : ''}`,
    next: (n: number) => `Lettre suivante · encore ${n}`,
    empty: 'Rien pour l’instant',
    replay: 'Rouvrir l’enveloppe',
    advance: 'Suivant',
    count: (n: number) => `${n} lettres t’attendent`,
    shoebox: 'Lettres déjà lues',
    transit: (n: number) => (n === 1 ? 'Une lettre est en route vers toi →' : `${n} lettres en route vers toi →`),
    back: '← à la boîte',
    offline: 'sans courrier (lab)',
    turnOver: 'Retourne la feuille',
    nextSheet: 'Feuille suivante',
    prevFace: 'Retour',
    overleaf: 'La suite au verso',
    where: (f: FaceRef, n: number) => `Feuille ${f.sheet + 1} sur ${n}${f.side === 'verso' ? ', verso' : ''}`,
  },
};

/** The desk's default hand, for the lab's sample letters. */
export const LAB_HAND: Omit<LetterLook, 'seed'> = { paper: 'cotton', ink: 'blueBlack', font: 'badScript' };

export type MailboxViewProps = {
  letters: MailLetter[];
  /** Language of the copy (the recipient's). */
  lang: Country;
  /** The mailbox: RU подъезд bank or FR batterie. */
  country: Country;
  /** FR nameplate. */
  name: string;
  /** Lab/QA: freeze a frame (≤ 0.7 receiving, up to 1 unfolding, above 1 reading at `fixedTurn`). */
  fixedT?: number;
  /** Lab/QA: where the reader is in the stack of sheets (see ReadingStack). */
  fixedTurn?: number;
  openMode?: OpenedBy;
  /** Shown over the closed box before the first letter (the lab's country switch). */
  header?: ReactNode;
  /** Shown once the box is empty (the shoebox, letters on their way). */
  emptyExtra?: ReactNode;
  onPhase?: (p: Phase) => void;
  onOpened?: (letter: MailLetter, by: OpenedBy) => void;
};

/** Open the box, take each letter out, open it, unfold, read; then the next one. */
export function MailboxView({ letters, lang, country, name, fixedT, fixedTurn, openMode = 'slit', header, emptyExtra, onPhase, onOpened }: MailboxViewProps) {
  const { width: sw, height: sh } = useWindowDimensions();
  const width = Math.min(sw, 480);
  const height = Math.round(Math.min(sh - 190, 640));
  const ew = Math.round(Math.min(width - 40, 360));
  const sheet = { width: Math.round(ew * 0.93), height: Math.round(ew * 0.93 * SHEET_RATIO) };
  const copy = MAILBOX_COPY[lang];

  const [index, setIndex] = useState(0);
  const letter = letters[index];

  const fixedReceive = fixedT !== undefined && fixedT <= 0.7 ? fixedT : undefined;
  const fixedUnfold = fixedT !== undefined && fixedT > 0.7 && fixedT <= 1 ? 1 - (fixedT - 0.7) / 0.3 : undefined;
  const fixedRead = fixedT !== undefined && fixedT > 1;
  const [phase, setPhase] = useState<Phase>(
    letters.length === 0 ? 'empty' : fixedRead ? 'read' : fixedUnfold !== undefined ? 'unfold' : 'mailbox',
  );
  const [stage, setStage] = useState<ReceiveStage>(0);
  const [advanceKey, setAdvanceKey] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const [openedBy, setOpenedBy] = useState<OpenedBy | null>(null);
  const { needsButtons } = useMotionPrefs();

  useEffect(() => {
    onPhase?.(phase);
    // report phase changes only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // The sheets are laid out with the seed they were written with.
  const letterLook: LetterLook = { ...(letter?.letterLook ?? LAB_HAND), seed: letter?.sheetSeed ?? letter?.seed ?? 1 };
  const sheets = letter ? sheetsOf(letter) : sheetsOf({ text: '' });
  const [reading, setReading] = useState<{ index: number; faces: FaceRef[] }>({ index: 0, faces: [] });
  const [step, setStep] = useState<{ key: number; dir: 1 | -1 } | undefined>(undefined);
  const look: EnvelopeLook = {
    paper: letter?.paper ?? 'cream',
    liner: 'postal',
    wax: letter?.wax ?? 'bordeaux',
    waxType: letter?.waxType,
    initials: letter?.initials ?? 'Н',
    seed: letter?.seed ?? 1,
    format: letter?.format,
  };
  const fold = letter?.fold ?? 'tri';
  const stack = useStackPictures(sheets, letterLook, sheet.width, sheet.height, 1, fold, letter?.strokesWidth);
  const { front, back } = stack;

  const onStage = (s: ReceiveStage) => {
    setStage(s);
    if (s === 5) setTimeout(() => setPhase('unfold'), 350);
  };
  const remaining = letters.length - index - 1;

  const hint =
    phase === 'empty'
      ? copy.empty
      : phase === 'mailbox'
        ? stage === 0 && letters.length - index > 1
          ? `${copy.hints[0]} · ${copy.count(letters.length - index)}`
          : copy.hints[stage]
        : phase === 'unfold'
          ? copy.unfold[fold]
          : copy.from(letter.fromLabel.name, letter.fromLabel.city, openedBy === 'seal');

  return (
    <Desk title={copy.title} hint={hint} scroll={phase === 'read' || (phase === 'empty' && !!emptyExtra)}>
      {phase === 'mailbox' && index === 0 && stage === 0 && header}
      {(phase === 'mailbox' || phase === 'empty') && back && (front || phase === 'empty') && (
        <View style={styles.stage}>
          <ReceivingCeremony
            key={`${index}-${replayKey}`}
            width={width}
            height={height}
            look={look}
            address={letter?.address ?? letters[0]?.address ?? { fromName: '', fromCity: '', toName: '', toCity: '' }}
            postmark={letter?.postmark ?? { city: '', date: '2026-10-24' }}
            letterFront={front ?? back}
            letterBack={back}
            sheet={sheet}
            sheets={stack.sheets}
            foldSeed={letterLook.seed}
            flat={47}
            name={name}
            country={country}
            senderCountry={letter?.senderCountry ?? 'ru'}
            waiting={phase === 'empty' ? 0 : letters.length - index}
            others={letters.slice(index + 1)}
            startOpen={index > 0 || phase === 'empty'}
            fixedT={phase === 'empty' ? 0.1 : fixedReceive}
            onStage={onStage}
            advanceKey={advanceKey}
            openMode={openMode}
            fold={fold}
            onOpened={(by) => {
              setOpenedBy(by);
              if (letter) onOpened?.(letter, by);
            }}
          />
        </View>
      )}
      {phase === 'unfold' && front && back && (
        <FoldableLetter
          front={front}
          back={back}
          sheets={stack.sheets}
          edgeColor={stack.edgeColor}
          width={sheet.width}
          height={sheet.height}
          seed={letterLook.seed}
          kind={fold}
          initialT={1}
          fixedT={fixedUnfold}
          onSettled={(t) => {
            // Re-reads skip straight to 'read'.
            if (t === 0) setPhase('read');
          }}
        />
      )}
      {phase === 'read' && (
        <ReadingStack
          key={`${index}-${replayKey}`}
          sheets={sheets}
          look={letterLook}
          width={sheet.width}
          height={sheet.height}
          fold={fold}
          strokesWidth={letter.strokesWidth}
          fixedTurn={fixedRead ? (fixedTurn ?? 0) : undefined}
          step={step}
          onFace={(i, faces) => setReading({ index: i, faces })}
        />
      )}
      {phase === 'read' && reading.faces.length > 1 && (
        <ReadingControls copy={copy} reading={reading} sheets={sheets.length} onStep={(dir) => setStep((s) => ({ key: (s?.key ?? 0) + 1, dir }))} />
      )}
      <View style={styles.actions}>
        {phase === 'mailbox' && stage < 5 && (
          <MailboxButton label={copy.advance} quiet={!needsButtons} onPress={() => setAdvanceKey((k) => k + 1)} />
        )}
        {phase === 'read' && remaining > 0 && (
          <MailboxButton
            label={copy.next(remaining)}
            onPress={() => {
              setIndex((i) => i + 1);
              setStage(1);
              setOpenedBy(null);
              setPhase('mailbox');
            }}
          />
        )}
        {phase === 'read' && remaining === 0 && <MailboxButton label={copy.empty} quiet onPress={() => setPhase('empty')} />}
        {phase === 'read' && (
          <MailboxButton
            label={copy.replay}
            quiet
            onPress={() => {
              setStage(0);
              setReplayKey((k) => k + 1);
              setPhase('mailbox');
            }}
          />
        )}
        {phase === 'empty' && emptyExtra}
      </View>
    </Desk>
  );
}

/** Under the sheet: where you are in the letter, and the tap alternative to the drag. */
function ReadingControls({
  copy,
  reading,
  sheets,
  onStep,
}: {
  copy: (typeof MAILBOX_COPY)['ru'];
  reading: { index: number; faces: FaceRef[] };
  sheets: number;
  onStep: (dir: 1 | -1) => void;
}) {
  const { needsButtons } = useMotionPrefs();
  const here = reading.faces[reading.index];
  const next = reading.faces[reading.index + 1];
  if (!here) return null;
  const overleaf = next && next.sheet === here.sheet;
  return (
    <View style={styles.reading}>
      <Text style={styles.note} accessibilityLiveRegion="polite" accessibilityLabel={copy.where(here, sheets)}>
        {overleaf ? copy.overleaf : copy.where(here, sheets)}
      </Text>
      <View style={styles.row}>
        {reading.index > 0 && <MailboxButton label={copy.prevFace} quiet onPress={() => onStep(-1)} />}
        {next && <MailboxButton label={overleaf ? copy.turnOver : copy.nextSheet} quiet={!needsButtons} onPress={() => onStep(1)} />}
      </View>
    </View>
  );
}

export function MailboxButton({ label, onPress, quiet = false }: { label: string; onPress: () => void; quiet?: boolean }) {
  return (
    <Pressable onPress={onPress} style={quiet ? styles.quiet : styles.button} accessibilityRole="button">
      <Text style={quiet ? styles.link : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stage: { marginHorizontal: -16 },
  actions: { alignItems: 'center', gap: 8, minHeight: 44 },
  button: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 3, backgroundColor: '#efe2cc' },
  buttonText: { color: '#2a211b', fontSize: 15 },
  quiet: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  link: { color: '#8f806b', fontSize: 12, textDecorationLine: 'underline' },
  linkLight: { color: '#e4d6bf', fontSize: 14, textDecorationLine: 'underline', paddingVertical: 4 },
  note: { color: '#b9a88f', fontSize: 13 },
  reading: { alignItems: 'center', gap: 2 },
  row: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  extra: { alignItems: 'center', gap: 10 },
  shoebox: { alignItems: 'center', gap: 2 },
  shoeboxTitle: { color: '#b9a88f', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
});
