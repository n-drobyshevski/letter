import { Link } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Choice } from '@/components/Choice';
import { Desk } from '@/components/Desk';
import { SignIn } from '@/components/SignIn';
import { openLetter, useCouple, useLettersInTransit, useMailbox, useSession, type Couple } from '@/lib/mail';
import { useLabParams } from '@/lib/params';
import { supabase } from '@/lib/supabase';
import { useMotionPrefs } from '@/lib/useMotionPrefs';
import type { EnvelopeLook } from '@/letter/EnvelopeCeremony';
import { FoldableLetter } from '@/letter/FoldableLetter';
import { LetterSheet, useLetterPicture, useWithStrokes, type LetterLook } from '@/letter/LetterSheet';
import { countryOf, type MailLetter } from '@/letter/mailboxFromServer';
import { ReceivingCeremony, type OpenedBy, type ReceiveStage } from '@/letter/ReceivingCeremony';
import { SAMPLE_LETTER, SAMPLE_LETTER_FR, SHORT_NOTES } from '@/letter/samples';
import { SHEET_RATIO } from '@/letter/sheet';
import { shortDate } from '@/letter/tracking/copy';
import type { Country, PaperKind, WaxKind, WaxType } from '@/theme/stationery';

type Phase = 'mailbox' | 'unfold' | 'read' | 'empty';

/** UI copy follows the recipient (it is their mailbox), informal ты/tu. */
const COPY = {
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
    unfold: 'Разверни: потяни вниз',
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
    unfold: 'Déplie-la : tire vers le bas',
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
  },
};

/** The desk's default hand, for the lab's sample letters. */
const LAB_HAND: Omit<LetterLook, 'seed'> = { paper: 'cotton', ink: 'blueBlack', font: 'badScript' };

const daysAgo = (n: number, fixed: boolean) =>
  fixed ? `2026-10-${String(24 - n).padStart(2, '0')}` : new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/**
 * The couple's two directions: a RU mailbox receives letters posted in France,
 * a FR mailbox receives letters posted in Russia. Oldest first.
 */
function lettersFor(recipient: Country, count: number, seed: number, fixed: boolean, waxType: WaxType): MailLetter[] {
  const waxes: WaxKind[] = ['bordeaux', 'gold', 'navy', 'forest'];
  const papers: PaperKind[] = ['cream', 'kraft', 'cream'];
  return Array.from({ length: count }, (_, i) => {
    const fromFrance = recipient === 'ru';
    const text = i === 0 ? (fromFrance ? SAMPLE_LETTER_FR : SAMPLE_LETTER) : SHORT_NOTES[fromFrance ? 'fr' : 'ru'][(i - 1) % 3];
    return {
      seed: seed + i * 977,
      text,
      paper: papers[i % papers.length],
      wax: waxes[i % waxes.length],
      waxType: i === 0 ? waxType : i % 2 ? 'flexible' : 'brittle',
      initials: fromFrance ? 'M' : 'Н',
      senderCountry: fromFrance ? 'fr' : 'ru',
      address: fromFrance
        ? { fromName: 'M.', fromCity: 'Paris', toName: 'N.', toCity: 'Moscou', toCountry: 'Russie' }
        : { fromName: 'Н.', fromCity: 'Москва', toName: 'М.', toCity: 'Paris, France' },
      postmark: { city: fromFrance ? 'Paris' : 'Москва', date: daysAgo(2 + (count - 1 - i), fixed) },
      fromLabel: fromFrance ? { name: 'М.', city: 'из Парижа' } : { name: 'N.', city: 'de Moscou' },
    };
  });
}

/**
 * The mailbox. Live (a backend and a signed-in member of the couple): the letters
 * delivered to you, opened for real. Otherwise the lab with sample letters.
 */
export default function MailboxScreen() {
  const session = useSession();
  const [offline, setOffline] = useState(false);
  const { couple, error } = useCouple(session?.user.id);

  if (!supabase || offline) return <MailboxLab />;
  if (session === undefined) return <Desk title="…" scroll={false}>{null}</Desk>;
  if (!session) {
    return (
      <Desk title="Почта · La Poste">
        <SignIn />
        <Pressable onPress={() => setOffline(true)}>
          <Text style={styles.link}>без почты (лаб) · sans courrier (lab)</Text>
        </Pressable>
      </Desk>
    );
  }
  if (!couple) return <Desk title="…" hint={error ?? undefined} scroll={false}>{null}</Desk>;
  return <LiveMailbox couple={couple} onOffline={() => setOffline(true)} />;
}

function LiveMailbox({ couple, onOffline }: { couple: Couple; onOffline: () => void }) {
  const { me } = couple;
  const lang: Country = me.locale;
  const copy = COPY[lang];
  const box = useMailbox(couple);
  const transit = useLettersInTransit(me.id).filter((l) => l.recipient_id === me.id);

  // Letters opened in this visit stay in the queue (so its order holds) until the box is empty again.
  const [openedNow, setOpenedNow] = useState<string[]>([]);
  const waiting = box.waiting.filter((l) => !openedNow.includes(l.id!));
  const shoebox = [...box.waiting.filter((l) => openedNow.includes(l.id!)).reverse(), ...box.opened];

  // One visit to the box = a fixed queue. A new visit starts whenever the box is idle
  // (empty, or not yet looked at) and holds letters the current visit doesn't.
  const [idle, setIdle] = useState(true);
  const waitingKey = waiting.map((l) => l.id).join(',');
  const [viewKey, setViewKey] = useState(waitingKey);
  if (idle && waitingKey !== viewKey) {
    setViewKey(waitingKey);
    setIdle(false);
  }
  // Read from both lists, so a refresh that marks a letter opened can't shift the queue.
  const inVisit = viewKey.split(',');
  const queue = [...box.waiting, ...box.opened]
    .filter((l) => inVisit.includes(l.id!))
    .sort((a, b) => Date.parse(a.deliverAt!) - Date.parse(b.deliverAt!));

  const [rereading, setRereading] = useState<MailLetter | null>(null);

  if (!box.loaded) return <Desk title={copy.title} scroll={false}>{null}</Desk>;
  if (rereading) return <Reread letter={rereading} lang={lang} onBack={() => setRereading(null)} />;

  const extra = (
    <View style={styles.extra}>
      {transit.length > 0 &&
        (transit[0].tracking ? (
          <Link href={`/track/${transit[0].id}`} style={styles.linkLight}>
            {copy.transit(transit.length)}
          </Link>
        ) : (
          <Text style={styles.note}>{copy.transit(transit.length).replace(' →', '')}</Text>
        ))}
      {shoebox.length > 0 && (
        <View style={styles.shoebox}>
          <Text style={styles.shoeboxTitle}>{copy.shoebox}</Text>
          {shoebox.map((l) => (
            <Pressable key={l.id} onPress={() => setRereading(l)} accessibilityRole="button">
              <Text style={styles.linkLight}>
                {l.fromLabel.name} · {shortDate(Date.parse(l.deliverAt!), me.tz, lang)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <Pressable onPress={onOffline}>
        <Text style={styles.link}>{copy.offline}</Text>
      </Pressable>
    </View>
  );

  return (
    <MailboxView
      key={viewKey}
      letters={queue}
      lang={lang}
      country={countryOf(me.tz)}
      name={me.display_name}
      emptyExtra={extra}
      onPhase={(p) => setIdle(p === 'empty')}
      onOpened={(letter, by) => {
        setOpenedNow((ids) => (ids.includes(letter.id!) ? ids : [...ids, letter.id!]));
        openLetter(letter.id!, by);
      }}
    />
  );
}

/** Re-reading skips the ceremony: the unfolded sheet, straight away. */
function Reread({ letter, lang, onBack }: { letter: MailLetter; lang: Country; onBack: () => void }) {
  const { width: sw } = useWindowDimensions();
  const ew = Math.round(Math.min(Math.min(sw, 480) - 40, 360));
  const sheet = { width: Math.round(ew * 0.93), height: Math.round(ew * 0.93 * SHEET_RATIO) };
  const copy = COPY[lang];
  return (
    <Desk title={copy.title} hint={copy.from(letter.fromLabel.name, letter.fromLabel.city, false)}>
      <LetterSheet
        text={letter.text}
        look={{ ...(letter.letterLook ?? LAB_HAND), seed: letter.seed }}
        width={sheet.width}
        height={sheet.height}
        crease={0.35}
        strokes={letter.strokes}
        strokesWidth={letter.strokesWidth}
      />
      <Button label={copy.back} quiet onPress={onBack} />
    </Desk>
  );
}

function MailboxLab() {
  const q = useLabParams();
  const fixed = q.t !== undefined;
  const [country, setCountry] = useState<Country>(q.country === 'fr' ? 'fr' : 'ru');
  const total = Math.max(0, Math.min(6, q.waiting ?? 1));
  const letters = useMemo(
    () => lettersFor(country, total, q.seed ?? 1407, fixed, q.wax === 'flexible' ? 'flexible' : 'brittle'),
    [country, total, q.seed, fixed, q.wax],
  );
  return (
    <MailboxView
      key={country}
      letters={letters}
      lang={country}
      country={country}
      name={country === 'fr' ? 'M. Laurent' : ''}
      fixedT={q.t}
      openMode={q.open === 'seal' ? 'seal' : 'slit'}
      header={
        <Choice options={[{ key: 'ru', label: 'Москва' }, { key: 'fr', label: 'Paris' }] as const} value={country} onChange={setCountry} />
      }
    />
  );
}

type ViewProps = {
  letters: MailLetter[];
  /** Language of the copy (the recipient's). */
  lang: Country;
  /** The mailbox: RU подъезд bank or FR batterie. */
  country: Country;
  /** FR nameplate. */
  name: string;
  /** Lab/QA: freeze a frame (≤ 0.7 receiving, above that unfolding). */
  fixedT?: number;
  openMode?: OpenedBy;
  /** Shown over the closed box before the first letter (the lab's country switch). */
  header?: ReactNode;
  /** Shown once the box is empty (the shoebox, letters on their way). */
  emptyExtra?: ReactNode;
  onPhase?: (p: Phase) => void;
  onOpened?: (letter: MailLetter, by: OpenedBy) => void;
};

/** Open the box, take each letter out, open it, unfold, read; then the next one. */
function MailboxView({ letters, lang, country, name, fixedT, openMode = 'slit', header, emptyExtra, onPhase, onOpened }: ViewProps) {
  const { width: sw, height: sh } = useWindowDimensions();
  const width = Math.min(sw, 480);
  const height = Math.round(Math.min(sh - 190, 640));
  const ew = Math.round(Math.min(width - 40, 360));
  const sheet = { width: Math.round(ew * 0.93), height: Math.round(ew * 0.93 * SHEET_RATIO) };
  const copy = COPY[lang];

  const [index, setIndex] = useState(0);
  const letter = letters[index];

  const fixedReceive = fixedT !== undefined && fixedT <= 0.7 ? fixedT : undefined;
  const fixedUnfold = fixedT !== undefined && fixedT > 0.7 ? 1 - (fixedT - 0.7) / 0.3 : undefined;
  const [phase, setPhase] = useState<Phase>(letters.length === 0 ? 'empty' : fixedUnfold !== undefined ? 'unfold' : 'mailbox');
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

  const letterLook: LetterLook = { ...(letter?.letterLook ?? LAB_HAND), seed: letter?.seed ?? 1 };
  const look: EnvelopeLook = {
    paper: letter?.paper ?? 'cream',
    liner: 'postal',
    wax: letter?.wax ?? 'bordeaux',
    waxType: letter?.waxType,
    initials: letter?.initials ?? 'Н',
    seed: letter?.seed ?? 1,
  };
  const { picture: inked } = useLetterPicture(letter?.text ?? '', letterLook, sheet.width, sheet.height, 1);
  const front = useWithStrokes(inked, letter?.strokes, letter?.strokesWidth, letterLook, sheet.width, sheet.height);
  const { picture: back } = useLetterPicture('', letterLook, sheet.width, sheet.height, 1, 'paper');

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
          ? copy.unfold
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
          width={sheet.width}
          height={sheet.height}
          seed={letter.seed}
          initialT={1}
          fixedT={fixedUnfold}
          onSettled={(t) => {
            // Re-reads skip straight to 'read'.
            if (t === 0) setPhase('read');
          }}
        />
      )}
      {phase === 'read' && (
        <LetterSheet
          text={letter.text}
          look={letterLook}
          width={sheet.width}
          height={sheet.height}
          crease={0.35}
          strokes={letter.strokes}
          strokesWidth={letter.strokesWidth}
        />
      )}
      <View style={styles.actions}>
        {phase === 'mailbox' && stage < 5 && (
          <Button label={copy.advance} quiet={!needsButtons} onPress={() => setAdvanceKey((k) => k + 1)} />
        )}
        {phase === 'read' && remaining > 0 && (
          <Button
            label={copy.next(remaining)}
            onPress={() => {
              setIndex((i) => i + 1);
              setStage(1);
              setOpenedBy(null);
              setPhase('mailbox');
            }}
          />
        )}
        {phase === 'read' && remaining === 0 && <Button label={copy.empty} quiet onPress={() => setPhase('empty')} />}
        {phase === 'read' && (
          <Button
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

function Button({ label, onPress, quiet = false }: { label: string; onPress: () => void; quiet?: boolean }) {
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
  extra: { alignItems: 'center', gap: 10 },
  shoebox: { alignItems: 'center', gap: 2 },
  shoeboxTitle: { color: '#b9a88f', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
});
