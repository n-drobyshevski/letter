import { Link, usePathname } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Choice } from '@/components/Choice';
import { Desk } from '@/components/Desk';
import { getLastDie, isEmptyDraft, setDraft, setLastDie, useDraft, type Draft } from '@/lib/draft';
import { useCouple, useSession } from '@/lib/mail';
import { useLabParams } from '@/lib/params';
import { useMotionPrefs } from '@/lib/useMotionPrefs';
import { EnvelopeCeremony, useSealingFit, type EnvelopeLook } from '@/letter/EnvelopeCeremony';
import { ENVELOPE_MM, formatForFold, type EnvelopeFormat } from '@/letter/envelope';
import { FOLD_KINDS, type FoldKind } from '@/letter/fold';
import { useLetterPicture, useWithStrokes, type LetterLook } from '@/letter/LetterSheet';
import { SAMPLE_LETTER } from '@/letter/samples';
import { parseDie, sealFromParams, type SealDie, type SealPlacement } from '@/letter/seal';
import { SealButtons } from '@/letter/SealButtons';
import { SEAL_COPY as COPY, useSealControls } from '@/letter/sealCopy';
import { SHEET_RATIO } from '@/letter/sheet';
import type { Lang } from '@/letter/tracking/copy';
import { LINERS, WAX, WAX_TYPES, type LinerKind, type PaperKind, type WaxKind, type WaxType } from '@/theme/stationery';

/**
 * Sealing the envelope. Two modes:
 *  - live (/seal, with a letter on the desk): the letter you wrote and folded goes in, and
 *    the seal you make (where the wax went, the die, how it was turned) is kept with the
 *    draft for the postbox, so the recipient finds exactly this seal;
 *  - lab (/lab/envelope): the sample letter, with QA params (?t= freezes a frame; sx, sy,
 *    kx, ky, rot, depth, die, hold place a stored seal; fold, seed, paper, country).
 * Every gesture has a button; they lead when Reduce Motion or a screen reader is on.
 */

const PAPER_OPTIONS = [
  { key: 'cream', label: 'Кремовый' },
  { key: 'kraft', label: 'Крафт' },
] as const;
const LANG_OPTIONS = [
  { key: 'ru', label: 'RU' },
  { key: 'fr', label: 'FR' },
] as const;
const LINER_OPTIONS = (Object.keys(LINERS) as LinerKind[]).map((k) => ({ key: k, label: LINERS[k].label }));
const WAX_OPTIONS = (Object.keys(WAX) as WaxKind[]).map((k) => ({ key: k, label: WAX[k].label }));
const WAX_TYPE_OPTIONS = (Object.keys(WAX_TYPES) as WaxType[]).map((k) => ({ key: k, label: WAX_TYPES[k].label }));

/** The DL width on screen, chosen so a C5 (229 mm) still fits when the letter is folded in half. */
function useEnvelopeWidth(format: EnvelopeFormat) {
  const fit = useSealingFit(format);
  return format === 'C5' ? Math.round((fit * ENVELOPE_MM.DL.w) / ENVELOPE_MM.C5.w) : fit;
}

export default function EnvelopeScreen() {
  const path = usePathname();
  const draft = useDraft();
  // /seal re-exports this screen: there it seals the letter on the desk.
  if (path === '/seal') return isEmptyDraft(draft) ? <NoLetter /> : <LiveSeal draft={draft!} />;
  return <EnvelopeLab />;
}

function useWriterLang() {
  const session = useSession();
  const { couple } = useCouple(session?.user.id);
  return { lang: (couple?.me.locale ?? 'ru') as Lang, name: couple?.me.display_name };
}

function NoLetter() {
  const { lang } = useWriterLang();
  return (
    <Desk title={COPY[lang].title} hint={COPY[lang].empty}>
      <Link href="/write" style={styles.link}>
        {COPY[lang].toDesk}
      </Link>
    </Desk>
  );
}

/** The real thing: the letter from the desk, sealed for the postbox. */
function LiveSeal({ draft }: { draft: Draft }) {
  const { lang, name } = useWriterLang();
  const fold = draft.fold ?? 'tri';
  const format = formatForFold(fold);
  const envW = useEnvelopeWidth(format);
  const sheet = { width: Math.round(envW * 0.93), height: Math.round(envW * 0.93 * SHEET_RATIO) };
  const { picture: inked } = useLetterPicture(draft.text, draft.look, sheet.width, sheet.height, 1, 'all', fold);
  const front = useWithStrokes(inked, draft.strokes, draft.sheetWidth, draft.look, sheet.width, sheet.height);
  const { picture: back } = useLetterPicture('', draft.look, sheet.width, sheet.height, 1, 'paper', fold);

  const kept = draft.envelope;
  const initials = name?.trim().charAt(0).toUpperCase() || (lang === 'fr' ? 'M' : 'Н');
  const [look, setLook] = useState<EnvelopeLook>(() => ({
    paper: kept?.paper ?? 'cream',
    liner: kept?.liner ?? 'postal',
    wax: kept?.wax ?? 'bordeaux',
    waxType: kept?.waxType ?? 'brittle',
    initials,
    // The envelope's own seed (tip wobble, wax outline): kept from here to the postbox.
    seed: kept?.seed ?? Math.floor(Math.random() * 2 ** 31),
    die: kept?.die ?? getLastDie() ?? 'monogram',
    seal: kept?.seal,
  }));
  // Coming back to an envelope already sealed: show it sealed, until you start again
  // (then the letter is already in and the flap shut: straight to the wax).
  const [frozen, setFrozen] = useState(() => !!kept);
  const [resealing, setResealing] = useState(false);

  const onSealed = (seal: SealPlacement) => {
    const die = look.die ?? 'monogram';
    setLook((l) => ({ ...l, seal }));
    setDraft({
      ...draft,
      envelope: {
        paper: look.paper,
        liner: look.liner,
        wax: look.wax,
        waxType: look.waxType ?? 'brittle',
        die,
        initials,
        seed: look.seed,
        format,
        seal,
      },
    });
  };
  // Starting over unseals the envelope: what goes to the post is only ever a finished seal.
  const unseal = () => {
    if (draft.envelope) setDraft({ ...draft, envelope: undefined });
  };

  return (
    <Sealing
      lang={lang}
      title={lang === 'fr' ? 'Cacheter' : 'Запечатать'}
      front={front}
      back={back}
      sheet={sheet}
      envW={envW}
      fold={fold}
      look={{ ...look, initials, format }}
      onLook={(patch) => setLook((l) => ({ ...l, ...patch }))}
      fixedT={frozen ? 1 : undefined}
      startT={resealing ? 0.5 : undefined}
      onSealed={onSealed}
      onReset={unseal}
      onReseal={() => {
        unseal();
        setFrozen(false);
        setResealing(true);
      }}
      live
    />
  );
}

/** The lab: the sample letter, and QA params that freeze any frame of any seal. */
function EnvelopeLab() {
  const q = useLabParams();
  const fold: FoldKind = FOLD_KINDS.includes(q.fold as FoldKind) ? (q.fold as FoldKind) : 'tri';
  const format = formatForFold(fold);
  const envW = useEnvelopeWidth(format);
  const sheet = { width: Math.round(envW * 0.93), height: Math.round(envW * 0.93 * SHEET_RATIO) };

  const seed = q.seed ?? 1407;
  const letterLook: LetterLook = { paper: 'cotton', ink: 'blueBlack', font: 'badScript', seed };
  const { picture: front } = useLetterPicture(SAMPLE_LETTER, letterLook, sheet.width, sheet.height, 1, 'all', fold);
  const { picture: back } = useLetterPicture('', letterLook, sheet.width, sheet.height, 1, 'paper', fold);

  const [lang, setLang] = useState<Lang>(q.country === 'fr' ? 'fr' : 'ru');
  const [look, setLook] = useState<Omit<EnvelopeLook, 'initials' | 'seed' | 'format'>>({
    paper: (q.paper as PaperKind) ?? 'cream',
    liner: 'postal',
    wax: (Object.keys(WAX) as WaxKind[]).find((w) => w === q.wax) ?? 'bordeaux',
    waxType: 'brittle',
    die: q.die ? parseDie(q.die) : 'monogram',
  });
  // A stored seal from the params (?sx=&sy=&kx=&ky=&rot=&depth=&hold=), for frozen frames.
  const seal = useMemo(
    () => sealFromParams({ sx: q.sx, sy: q.sy, kx: q.kx, ky: q.ky, rot: q.rot, depth: q.depth, hold: q.hold }, format, seed),
    [q.sx, q.sy, q.kx, q.ky, q.rot, q.depth, q.hold, format, seed],
  );

  return (
    <Sealing
      lang={lang}
      onLang={setLang}
      title={COPY[lang].title}
      front={front}
      back={back}
      sheet={sheet}
      envW={envW}
      fold={fold}
      look={{ ...look, initials: lang === 'fr' ? 'M' : 'Н', seed, format, seal }}
      onLook={(patch) => setLook((l) => ({ ...l, ...patch }))}
      fixedT={q.t}
    />
  );
}

/** The screen around the ceremony: the look choices, the hint, the buttons. */
function Sealing(props: {
  lang: Lang;
  onLang?: (lang: Lang) => void;
  title: string;
  front: ReturnType<typeof useLetterPicture>['picture'];
  back: ReturnType<typeof useLetterPicture>['picture'];
  sheet: { width: number; height: number };
  envW: number;
  fold: FoldKind;
  look: EnvelopeLook;
  onLook: (patch: Partial<EnvelopeLook>) => void;
  fixedT?: number;
  /** Start live with the letter in and the flap shut (sealing again). */
  startT?: number;
  onSealed?: (seal: SealPlacement) => void;
  onReset?: () => void;
  onReseal?: () => void;
  live?: boolean;
}) {
  const { lang, look, onLook, fixedT, live = false } = props;
  const { needsButtons } = useMotionPrefs();
  const [resetKey, setResetKey] = useState(0);
  const { copy, stage, shown, actions, run, ceremony } = useSealControls(lang, props.onReset, {
    needsButtons,
    fixed: fixedT !== undefined,
  });
  const onDie = (die: SealDie) => {
    ceremony.onDie(die);
    onLook({ die });
    setLastDie(die);
  };

  return (
    <Desk title={props.title} hint={shown}>
      {props.front && props.back && (
        <EnvelopeCeremony
          letterFront={props.front}
          letterBack={props.back}
          sheet={props.sheet}
          width={props.envW}
          look={look}
          fold={props.fold}
          lang={lang}
          needsButtons={needsButtons}
          {...ceremony}
          onDie={onDie}
          onSealed={props.onSealed}
          fixedT={fixedT}
          startT={props.startT}
          resetKey={resetKey}
        />
      )}
      <View style={styles.actions}>
        <SealButtons actions={actions} lang={lang} quiet={!needsButtons} onRun={run} />
        {stage === 4 && live && (
          <Link href="/post" style={styles.button}>
            {copy.toPost}
          </Link>
        )}
        {stage === 4 && (
          <Pressable
            onPress={() => {
              if (live && fixedT !== undefined) props.onReseal?.();
              else if (live) run('reset');
              else setResetKey((k) => k + 1);
            }}
            accessibilityRole="button"
            style={styles.quiet}
          >
            <Text style={styles.link}>{live ? (fixedT !== undefined ? copy.reseal : copy.buttons.reset) : copy.again}</Text>
          </Pressable>
        )}
      </View>
      {/* The look, under the ceremony: the envelope and its buttons come first on a short screen. */}
      {(!live || stage < 2) && (
        <>
          <View style={styles.row}>
            <Choice options={PAPER_OPTIONS} value={look.paper as 'cream' | 'kraft'} onChange={(paper) => onLook({ paper })} />
            {props.onLang && <Choice options={LANG_OPTIONS} value={lang} onChange={props.onLang} />}
          </View>
          <Choice options={LINER_OPTIONS} value={look.liner} onChange={(liner) => onLook({ liner })} />
          <Choice options={WAX_OPTIONS} value={look.wax} onChange={(wax) => onLook({ wax })} />
          <Choice options={WAX_TYPE_OPTIONS} value={look.waxType ?? 'brittle'} onChange={(waxType) => onLook({ waxType })} />
        </>
      )}
    </Desk>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', alignItems: 'center' },
  actions: { alignItems: 'center', gap: 10, minHeight: 44 },
  button: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 3,
    backgroundColor: '#efe2cc',
    color: '#2a211b',
    fontSize: 15,
    overflow: 'hidden',
  },
  quiet: { minHeight: 44, paddingHorizontal: 6, justifyContent: 'center' },
  link: { color: '#b9a88f', fontSize: 13, textDecorationLine: 'underline' },
});
