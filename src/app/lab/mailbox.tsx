import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Choice } from '@/components/Choice';
import { Desk } from '@/components/Desk';
import { LAB_HAND, MAILBOX_COPY, MailboxButton, MailboxView, ReadingControls } from '@/components/MailboxView';
import { SignIn } from '@/components/SignIn';
import { openLetter, useCouple, useLettersInTransit, useMailbox, useSession, type Couple } from '@/lib/mail';
import { useLabParams } from '@/lib/params';
import { supabase } from '@/lib/supabase';
import { formatForFold } from '@/letter/envelope';
import { FOLD_KINDS, type FoldKind } from '@/letter/fold';
import { countryOf, sheetsOf, type MailLetter } from '@/letter/mailboxFromServer';
import { ReadingStack } from '@/letter/ReadingStack';
import type { FaceRef } from '@/letter/stack';
import { SAMPLE_LETTER, SAMPLE_LETTER_FR, SHORT_NOTES, sampleSheets } from '@/letter/samples';
import { SHEET_RATIO } from '@/letter/sheet';
import { shortDate } from '@/letter/tracking/copy';
import type { Country, PaperKind, WaxKind, WaxType } from '@/theme/stationery';

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
  const copy = MAILBOX_COPY[lang];
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

/** Re-reading skips the ceremony: the unfolded sheets, straight away, from the first page. */
function Reread({ letter, lang, onBack }: { letter: MailLetter; lang: Country; onBack: () => void }) {
  const { width: sw } = useWindowDimensions();
  const ew = Math.round(Math.min(Math.min(sw, 480) - 40, 360));
  const sheet = { width: Math.round(ew * 0.93), height: Math.round(ew * 0.93 * SHEET_RATIO) };
  const copy = MAILBOX_COPY[lang];
  const sheets = sheetsOf(letter);
  const [reading, setReading] = useState<{ index: number; faces: FaceRef[] }>({ index: 0, faces: [] });
  const [step, setStep] = useState<{ key: number; dir: 1 | -1 } | undefined>(undefined);
  return (
    <Desk title={copy.title} hint={copy.from(letter.fromLabel.name, letter.fromLabel.city, false)}>
      <ReadingStack
        sheets={sheets}
        look={{ ...(letter.letterLook ?? LAB_HAND), seed: letter.sheetSeed ?? letter.seed }}
        width={sheet.width}
        height={sheet.height}
        fold={letter.fold ?? 'tri'}
        strokesWidth={letter.strokesWidth}
        step={step}
        onFace={(index, faces) => setReading({ index, faces })}
      />
      {reading.faces.length > 1 && (
        <ReadingControls copy={copy} reading={reading} sheets={sheets.length} onStep={(dir) => setStep((s) => ({ key: (s?.key ?? 0) + 1, dir }))} />
      )}
      <MailboxButton label={copy.back} quiet onPress={onBack} />
    </Desk>
  );
}

function MailboxLab() {
  const q = useLabParams();
  const fixed = q.t !== undefined;
  const [country, setCountry] = useState<Country>(q.country === 'fr' ? 'fr' : 'ru');
  const total = Math.max(0, Math.min(6, q.waiting ?? 1));
  // ?fold=half|quarter: the first letter is folded that way, in its envelope (C5, C6).
  const fold = FOLD_KINDS.includes(q.fold as FoldKind) ? (q.fold as FoldKind) : undefined;
  // ?sheets=2..4: the first letter is a stack of sample sheets, written on both sides.
  const letters = useMemo(() => {
    let list = lettersFor(country, total, q.seed ?? 1407, fixed, q.wax === 'flexible' ? 'flexible' : 'brittle');
    if (q.sheets && q.sheets > 1 && list[0]) {
      const sheets = sampleSheets(q.sheets);
      list = [{ ...list[0], text: sheets[0].recto.text, sheets }, ...list.slice(1)];
    }
    return fold && list[0] ? [{ ...list[0], fold, format: formatForFold(fold) }, ...list.slice(1)] : list;
  }, [country, total, q.seed, fixed, q.wax, fold, q.sheets]);
  return (
    <MailboxView
      key={country}
      letters={letters}
      lang={country}
      country={country}
      name={country === 'fr' ? 'M. Laurent' : ''}
      fixedT={q.t}
      fixedTurn={q.turn}
      fixedTilt={q.tilt}
      openMode={q.open === 'seal' ? 'seal' : 'slit'}
      header={
        <Choice options={[{ key: 'ru', label: 'Москва' }, { key: 'fr', label: 'Paris' }] as const} value={country} onChange={setCountry} />
      }
    />
  );
}

const styles = StyleSheet.create({
  link: { color: '#8f806b', fontSize: 12, textDecorationLine: 'underline' },
  linkLight: { color: '#e4d6bf', fontSize: 14, textDecorationLine: 'underline', paddingVertical: 4 },
  note: { color: '#b9a88f', fontSize: 13 },
  extra: { alignItems: 'center', gap: 10 },
  shoebox: { alignItems: 'center', gap: 2 },
  shoeboxTitle: { color: '#b9a88f', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
});
