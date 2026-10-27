import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Choice } from '@/components/Choice';
import { Desk } from '@/components/Desk';
import { MailboxView } from '@/components/MailboxView';
import { useLabParams } from '@/lib/params';
import { useMotionPrefs } from '@/lib/useMotionPrefs';
import { EnvelopeCeremony, type EnvelopeLook, type Stage } from '@/letter/EnvelopeCeremony';
import { ENVELOPE_MM, formatForFold } from '@/letter/envelope';
import { FOLD_KINDS, type FoldKind } from '@/letter/fold';
import { FoldableLetter } from '@/letter/FoldableLetter';
import { DeskStack } from '@/letter/DeskStack';
import { useStackPictures, type LetterLook } from '@/letter/LetterSheet';
import type { MailLetter } from '@/letter/mailboxFromServer';
import { PostingCeremony } from '@/letter/PostingCeremony';
import { SAMPLE_LETTER, sampleSheets } from '@/letter/samples';
import { SHEET_RATIO, useSheetSize } from '@/letter/sheet';
import { defaultTwoSided, emptyFace, emptySheet, isEmptySheet, maxSheetsFor, trimSheets, type SheetContent } from '@/letter/stack';
import type { WritingMode } from '@/letter/WritingDesk';
import { WAX, type Country, type PaperKind, type WaxKind } from '@/theme/stationery';

/**
 * Lab: the whole journey of one letter, offline. Write it, fold it (the gesture
 * picks the fold), slide it into an envelope sized for that fold and seal it, drop
 * it in the postbox; then skip the weeks and open it in her mailbox.
 * `?step=fold|envelope|post|receive` starts later with a sample letter (QA),
 * `?sheets=1..4` with a sample stack of that many sheets.
 */

type Step = 'write' | 'fold' | 'envelope' | 'post' | 'receive';
const STEPS: { key: Step; label: string }[] = [
  { key: 'write', label: 'Письмо' },
  { key: 'fold', label: 'Сложить' },
  { key: 'envelope', label: 'Конверт' },
  { key: 'post', label: 'Почта' },
  { key: 'receive', label: 'У неё' },
];

const PAPERS = [
  { key: 'grid', label: 'Тетрадь' },
  { key: 'cotton', label: 'Хлопок' },
] as const;
const MODES = [
  { key: 'keyboard', label: 'Клавиатура' },
  { key: 'pen', label: 'Перо' },
] as const;
const COUNTRIES = [
  { key: 'fr', label: 'Из Лилля' },
  { key: 'ru', label: 'Из Москвы' },
] as const;
const ENVELOPE_PAPERS = [
  { key: 'cream', label: 'Кремовый' },
  { key: 'kraft', label: 'Крафт' },
] as const;
const WAX_OPTIONS = (Object.keys(WAX) as WaxKind[]).map((k) => ({ key: k, label: WAX[k].label }));

const FOLD_NAMES: Record<FoldKind, string> = { tri: 'втрое', half: 'пополам', quarter: 'вчетверо' };
const HOUR = 3600e3;
const clock = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

export default function JourneyLab() {
  const q = useLabParams();
  const startAt = STEPS.some((s) => s.key === q.step) ? (q.step as Step) : 'write';
  const seed = q.seed ?? 1407;

  const [step, setStep] = useState<Step>(startAt);
  const [paper, setPaper] = useState<PaperKind>('grid');
  const sample = (): SheetContent[] =>
    q.sheets ? sampleSheets(q.sheets) : [{ recto: { text: SAMPLE_LETTER, strokes: [] }, verso: emptyFace(), twoSided: defaultTwoSided('grid') }];
  const [sheets, setSheets] = useState<SheetContent[]>(() => (startAt === 'write' && !q.sheets ? [emptySheet('grid')] : sample()));
  const [fold, setFold] = useState<FoldKind>(FOLD_KINDS.includes(q.fold as FoldKind) ? (q.fold as FoldKind) : 'tri');
  const [envelope, setEnvelope] = useState<{ paper: PaperKind; wax: WaxKind }>({ paper: 'cream', wax: 'bordeaux' });
  const [from, setFrom] = useState<Country>('fr');
  const writeSize = useSheetSize();

  const hand: LetterLook = { paper, ink: 'blueBlack', font: 'badScript', seed };
  // What leaves the desk: the sheets written on (a blank one taken last stays behind).
  const letter = { sheets: trimSheets(sheets), strokesWidth: writeSize.width, hand, fold };
  const look: EnvelopeLook = {
    paper: envelope.paper,
    liner: 'postal',
    wax: envelope.wax,
    initials: from === 'fr' ? 'Н' : 'М',
    seed,
    format: formatForFold(fold),
  };
  const restart = () => {
    setSheets([emptySheet(paper)]);
    setFold('tri');
    setStep('write');
  };
  const progress = <Progress at={step} />;

  switch (step) {
    case 'write':
      return (
        <WriteStep
          progress={progress}
          hand={hand}
          size={writeSize}
          sheets={sheets}
          onSheets={setSheets}
          paper={paper}
          onPaper={setPaper}
          onNext={() => setStep('fold')}
        />
      );
    case 'fold':
      return (
        <FoldStep
          progress={progress}
          letter={letter}
          onFolded={(k) => {
            setFold(k);
            setStep('envelope');
          }}
        />
      );
    case 'envelope':
      return (
        <EnvelopeStep progress={progress} letter={letter} look={look} envelope={envelope} onEnvelope={setEnvelope} onNext={() => setStep('post')} />
      );
    case 'post':
      return <PostStep progress={progress} look={look} from={from} onFrom={setFrom} onNext={() => setStep('receive')} />;
    case 'receive':
      return <ReceiveStep progress={progress} letter={letter} look={look} from={from} onRestart={restart} />;
  }
}

type Letter = { sheets: SheetContent[]; strokesWidth: number; hand: LetterLook; fold: FoldKind };

/** Where you are on the way: the steps done, this one, the ones to come. */
function Progress({ at }: { at: Step }) {
  const i = STEPS.findIndex((s) => s.key === at);
  return (
    <View style={styles.progress} accessibilityRole="progressbar" accessibilityLabel={`${i + 1} / ${STEPS.length}: ${STEPS[i].label}`}>
      {STEPS.map((s, k) => (
        <Text key={s.key} style={[styles.dot, k < i && styles.done, k === i && styles.current]}>
          {k > 0 ? '·  ' : ''}
          {s.label}
        </Text>
      ))}
    </View>
  );
}

function WriteStep(props: {
  progress: React.ReactNode;
  hand: LetterLook;
  size: { width: number; height: number };
  sheets: SheetContent[];
  onSheets: (s: SheetContent[]) => void;
  paper: PaperKind;
  onPaper: (p: PaperKind) => void;
  onNext: () => void;
}) {
  const [mode, setMode] = useState<WritingMode>('keyboard');
  const written = !props.sheets.every(isEmptySheet);
  return (
    <Desk title="Письмо" hint="Напиши ей. Перо — для подписи и рисунков">
      {props.progress}
      <View style={styles.row}>
        <Choice options={PAPERS} value={props.paper as 'grid' | 'cotton'} onChange={props.onPaper} />
        <Choice options={MODES} value={mode} onChange={setMode} />
      </View>
      <DeskStack
        look={props.hand}
        width={props.size.width}
        height={props.size.height}
        mode={mode}
        sheets={props.sheets}
        onSheets={props.onSheets}
        placeholder="Моя хорошая, …"
      />
      <View style={styles.actions}>
        {written && <Button label="Сложить →" onPress={props.onNext} />}
      </View>
    </Desk>
  );
}

function FoldStep({ progress, letter, onFolded }: { progress: React.ReactNode; letter: Letter; onFolded: (k: FoldKind) => void }) {
  const size = useSheetSize(440, 72);
  const [kind, setKind] = useState<FoldKind | null>(null);
  const [folded, setFolded] = useState<FoldKind | null>(null);
  const { needsButtons } = useMotionPrefs();
  // Creases appear once a fold has begun.
  const crease = kind ? 1 : 0;
  const stack = useStackPictures(letter.sheets, letter.hand, size.width, size.height, crease, kind ?? 'tri', letter.strokesWidth);
  const { front, back } = stack;
  const allowQuarter = letter.sheets.length <= maxSheetsFor('quarter');
  const hint = folded
    ? `Сложено ${FOLD_NAMES[folded]}${folded === 'half' ? ' — проведи влево, чтобы ещё раз' : ''}`
    : kind
      ? `Складываешь ${FOLD_NAMES[kind]}`
      : 'Снизу вверх — втрое · верхний край вниз — пополам, потом влево — вчетверо';
  return (
    <Desk title="Сложить" hint={hint} scroll={false}>
      {progress}
      {front && back && (
        <FoldableLetter
          front={front}
          back={back}
          sheets={stack.sheets}
          edgeColor={stack.edgeColor}
          allowQuarter={allowQuarter}
          width={size.width}
          height={size.height}
          seed={letter.hand.seed}
          onKind={setKind}
          onSettled={(t, k) => setFolded(t === 1 ? k : null)}
        />
      )}
      <View style={styles.actions}>
        {folded && <Button label="В конверт →" onPress={() => onFolded(folded)} />}
        {!folded && needsButtons && (
          <View style={styles.row}>
            {FOLD_KINDS.filter((k) => allowQuarter || k !== 'quarter').map((k) => (
              <Button key={k} label={FOLD_NAMES[k]} onPress={() => onFolded(k)} />
            ))}
          </View>
        )}
      </View>
    </Desk>
  );
}

const ENVELOPE_HINTS: Record<Stage, string> = {
  0: 'Потяни письмо вниз, в конверт',
  1: 'Закрой клапан: потяни вниз или коснись',
  2: 'Удерживай, чтобы налить сургуч',
  3: 'Печать…',
  4: 'Запечатано',
};

function EnvelopeStep(props: {
  progress: React.ReactNode;
  letter: Letter;
  look: EnvelopeLook;
  envelope: { paper: PaperKind; wax: WaxKind };
  onEnvelope: (e: { paper: PaperKind; wax: WaxKind }) => void;
  onNext: () => void;
}) {
  const { letter, look } = props;
  const { width: screenW } = useWindowDimensions();
  // The DL width on screen, chosen so the widest envelope (a C5, 229 mm) still fits.
  const envW = Math.round((Math.min(screenW - 48, 480) * ENVELOPE_MM.DL.w) / ENVELOPE_MM.C5.w);
  const sheet = { width: Math.round(envW * 0.93), height: Math.round(envW * 0.93 * SHEET_RATIO) };
  const { front, back, sheets } = useStackPictures(letter.sheets, letter.hand, sheet.width, sheet.height, 1, letter.fold, letter.strokesWidth);
  const [stage, setStage] = useState<Stage>(0);
  return (
    <Desk title={`Конверт ${look.format}`} hint={ENVELOPE_HINTS[stage]} scroll={false}>
      {props.progress}
      {stage === 0 && (
        <View style={styles.row}>
          <Choice options={ENVELOPE_PAPERS} value={props.envelope.paper as 'cream' | 'kraft'} onChange={(paper) => props.onEnvelope({ ...props.envelope, paper })} />
          <Choice options={WAX_OPTIONS} value={props.envelope.wax} onChange={(wax) => props.onEnvelope({ ...props.envelope, wax })} />
        </View>
      )}
      {front && back && (
        <EnvelopeCeremony
          letterFront={front}
          letterBack={back}
          sheet={sheet}
          sheets={sheets}
          foldSeed={letter.hand.seed}
          width={envW}
          look={look}
          fold={letter.fold}
          onStage={setStage}
        />
      )}
      <View style={styles.actions}>{stage === 4 && <Button label="На почту →" onPress={props.onNext} />}</View>
    </Desk>
  );
}

function PostStep(props: { progress: React.ReactNode; look: EnvelopeLook; from: Country; onFrom: (c: Country) => void; onNext: () => void }) {
  const { width: sw, height: sh } = useWindowDimensions();
  const width = Math.min(sw, 480);
  const height = Math.round(Math.min(sh - 230, 640));
  const [posted, setPosted] = useState(false);
  const [commitKey, setCommitKey] = useState(0);
  const [retrieveKey, setRetrieveKey] = useState(0);
  const [collectAt] = useState(() => clock(new Date(Date.now() + HOUR)));
  const { needsButtons } = useMotionPrefs();
  return (
    <Desk
      title="Почтовый ящик"
      hint={posted ? `Письмо в ящике. Можно забрать до ${collectAt}` : 'Опусти письмо в ящик: потяни вверх'}
      scroll={false}
    >
      {props.progress}
      {!posted && <Choice options={COUNTRIES} value={props.from as 'fr' | 'ru'} onChange={props.onFrom} />}
      <View style={styles.stage}>
        <PostingCeremony
          key={props.from}
          width={width}
          height={height}
          look={props.look}
          skin="blue"
          country={props.from}
          collectAt={collectAt}
          commitKey={commitKey}
          retrieveKey={retrieveKey}
          onPosted={() => setPosted(true)}
          onRetrieved={() => setPosted(false)}
        />
      </View>
      <View style={styles.actions}>
        {!posted && <Button label="Опустить" quiet={!needsButtons} onPress={() => setCommitKey((k) => k + 1)} />}
        {posted && (
          <View style={styles.row}>
            <Button label="Забрать" quiet onPress={() => setRetrieveKey((k) => k + 1)} />
            <Button label="Перемотать недели → у неё в ящике" onPress={props.onNext} />
          </View>
        )}
      </View>
    </Desk>
  );
}

function ReceiveStep(props: { progress: React.ReactNode; letter: Letter; look: EnvelopeLook; from: Country; onRestart: () => void }) {
  const { letter, look, from } = props;
  const fromFrance = from === 'fr';
  const mail: MailLetter = {
    seed: look.seed,
    sheetSeed: letter.hand.seed,
    text: letter.sheets[0].recto.text,
    strokes: letter.sheets[0].recto.strokes.length ? letter.sheets[0].recto.strokes : undefined,
    sheets: letter.sheets,
    strokesWidth: letter.strokesWidth,
    letterLook: { paper: letter.hand.paper, ink: letter.hand.ink, font: letter.hand.font },
    fold: letter.fold,
    format: look.format,
    paper: look.paper,
    wax: look.wax,
    waxType: 'brittle',
    initials: look.initials,
    address: fromFrance
      ? { fromName: 'Н.', fromCity: 'Lille', toName: 'М.', toCity: 'Minsk', toCountry: 'Biélorussie' }
      : { fromName: 'М.', fromCity: 'Москва', toName: 'N.', toCity: 'Lille', toCountry: 'Франция' },
    postmark: { city: fromFrance ? 'Lille' : 'Москва', date: new Date().toISOString().slice(0, 10) },
    senderCountry: from,
    fromLabel: fromFrance ? { name: 'Н.', city: 'Lille' } : { name: 'М.', city: 'Москва' },
  };
  // Her mailbox is at the other end: a Minsk подъезд for a letter from France, a Lille batterie otherwise.
  const herBox: Country = fromFrance ? 'ru' : 'fr';
  return (
    <MailboxView
      letters={[mail]}
      lang="ru"
      country={herBox}
      name={fromFrance ? '' : 'N.'}
      header={props.progress}
      emptyExtra={<Button label="Ещё одно письмо — с начала" onPress={props.onRestart} />}
    />
  );
}

function Button({ label, onPress, quiet = false }: { label: string; onPress: () => void; quiet?: boolean }) {
  return (
    <Pressable onPress={onPress} style={quiet ? styles.quiet : styles.button} accessibilityRole="button">
      <Text style={quiet ? styles.link : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 2 },
  dot: { color: '#6f6252', fontSize: 12 },
  done: { color: '#b9a88f' },
  current: { color: '#efe2cc', fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  actions: { alignItems: 'center', gap: 8, minHeight: 44 },
  stage: { marginHorizontal: -16 },
  button: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 3, backgroundColor: '#efe2cc' },
  buttonText: { color: '#2a211b', fontSize: 15 },
  quiet: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  link: { color: '#8f806b', fontSize: 12, textDecorationLine: 'underline' },
});
