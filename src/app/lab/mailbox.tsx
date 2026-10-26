import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Choice } from '@/components/Choice';
import { Desk } from '@/components/Desk';
import { useLabParams } from '@/lib/params';
import { useMotionPrefs } from '@/lib/useMotionPrefs';
import type { EnvelopeLook } from '@/letter/EnvelopeCeremony';
import type { Address, Postmark } from '@/letter/envelopeFront';
import { FoldableLetter } from '@/letter/FoldableLetter';
import { LetterSheet, useLetterPicture, type LetterLook } from '@/letter/LetterSheet';
import { ReceivingCeremony, type OpenedBy, type ReceiveStage } from '@/letter/ReceivingCeremony';
import { SAMPLE_LETTER, SAMPLE_LETTER_FR, SHORT_NOTES } from '@/letter/samples';
import { SHEET_RATIO } from '@/letter/sheet';
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
  },
};

type Letter = {
  seed: number;
  text: string;
  paper: PaperKind;
  wax: WaxKind;
  waxType: WaxType;
  initials: string;
  address: Address;
  postmark: Postmark;
  senderCountry: Country;
  fromLabel: { name: string; city: string };
};

const daysAgo = (n: number, fixed: boolean) =>
  fixed ? `2026-10-${String(24 - n).padStart(2, '0')}` : new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/**
 * The couple's two directions: a RU mailbox receives letters posted in France,
 * a FR mailbox receives letters posted in Russia. Oldest first.
 */
function lettersFor(recipient: Country, count: number, seed: number, fixed: boolean, waxType: WaxType): Letter[] {
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

export default function MailboxLab() {
  const q = useLabParams();
  const { width: sw, height: sh } = useWindowDimensions();
  const width = Math.min(sw, 480);
  const height = Math.round(Math.min(sh - 190, 640));
  const ew = Math.round(Math.min(width - 40, 360));
  const sheet = { width: Math.round(ew * 0.93), height: Math.round(ew * 0.93 * SHEET_RATIO) };
  const fixed = q.t !== undefined;

  const [country, setCountry] = useState<Country>(q.country === 'fr' ? 'fr' : 'ru');
  const copy = COPY[country];
  const total = Math.max(0, Math.min(6, q.waiting ?? 1));
  const letters = useMemo(
    () => lettersFor(country, total, q.seed ?? 1407, fixed, q.wax === 'flexible' ? 'flexible' : 'brittle'),
    [country, total, q.seed, fixed, q.wax],
  );
  const [index, setIndex] = useState(0);
  const letter = letters[index];

  const fixedReceive = q.t !== undefined && q.t <= 0.7 ? q.t : undefined;
  const fixedUnfold = q.t !== undefined && q.t > 0.7 ? 1 - (q.t - 0.7) / 0.3 : undefined;
  const [phase, setPhase] = useState<Phase>(total === 0 ? 'empty' : fixedUnfold !== undefined ? 'unfold' : 'mailbox');
  const [stage, setStage] = useState<ReceiveStage>(0);
  const [advanceKey, setAdvanceKey] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const [openedBy, setOpenedBy] = useState<OpenedBy | null>(null);
  const { needsButtons } = useMotionPrefs();

  const letterLook: LetterLook = { paper: 'cotton', ink: 'blueBlack', font: 'badScript', seed: letter?.seed ?? 1 };
  const look: EnvelopeLook = {
    paper: letter?.paper ?? 'cream',
    liner: 'postal',
    wax: letter?.wax ?? 'bordeaux',
    waxType: letter?.waxType,
    initials: letter?.initials ?? 'Н',
    seed: letter?.seed ?? 1,
  };
  const { picture: front } = useLetterPicture(letter?.text ?? '', letterLook, sheet.width, sheet.height, 1);
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

  const changeCountry = (c: Country) => {
    setCountry(c);
    setIndex(0);
    setStage(0);
    setReplayKey((k) => k + 1);
    setPhase(total === 0 ? 'empty' : 'mailbox');
  };

  return (
    <Desk title={copy.title} hint={hint} scroll={phase === 'read'}>
      {phase === 'mailbox' && index === 0 && stage === 0 && (
        <Choice options={[{ key: 'ru', label: 'Москва' }, { key: 'fr', label: 'Paris' }] as const} value={country} onChange={changeCountry} />
      )}
      {(phase === 'mailbox' || phase === 'empty') && back && (front || phase === 'empty') && (
        <View style={styles.stage}>
          <ReceivingCeremony
            key={`${country}-${index}-${replayKey}`}
            width={width}
            height={height}
            look={look}
            address={letter?.address ?? letters[0]?.address ?? { fromName: '', fromCity: '', toName: '', toCity: '' }}
            postmark={letter?.postmark ?? { city: '', date: '2026-10-24' }}
            letterFront={front ?? back}
            letterBack={back}
            sheet={sheet}
            flat={47}
            name={country === 'fr' ? 'M. Laurent' : ''}
            country={country}
            senderCountry={letter?.senderCountry ?? 'ru'}
            waiting={phase === 'empty' ? 0 : letters.length - index}
            others={letters.slice(index + 1)}
            startOpen={index > 0 || phase === 'empty'}
            fixedT={phase === 'empty' ? 0.1 : fixedReceive}
            onStage={onStage}
            advanceKey={advanceKey}
            openMode={q.open === 'seal' ? 'seal' : 'slit'}
            // The real app calls open_letter(id, openedBy).
            onOpened={setOpenedBy}
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
        <LetterSheet text={letter.text} look={letterLook} width={sheet.width} height={sheet.height} crease={0.35} />
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
});
