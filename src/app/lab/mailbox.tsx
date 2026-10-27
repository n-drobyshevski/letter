import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Choice } from '@/components/Choice';
import { Desk } from '@/components/Desk';
import { LAB_HAND, MAILBOX_COPY, MailboxButton, MailboxView } from '@/components/MailboxView';
import { SignIn } from '@/components/SignIn';
import { openLetter, useCouple, useLettersInTransit, useMailbox, useSession, type Couple } from '@/lib/mail';
import { useLabParams } from '@/lib/params';
import { supabase } from '@/lib/supabase';
import { LetterSheet } from '@/letter/LetterSheet';
import { formatForFold } from '@/letter/envelope';
import { FOLD_KINDS, type FoldKind } from '@/letter/fold';
import { countryOf, type MailLetter } from '@/letter/mailboxFromServer';
import { SAMPLE_LETTER, SAMPLE_LETTER_FR, SHORT_NOTES } from '@/letter/samples';
import { FLAP_TIP, parseDie, parseSeal, presetSeal, sealFromParams, tipFraction, type SealDie, type SealPlacement } from '@/letter/seal';
import { SHEET_RATIO } from '@/letter/sheet';
import { shortDate } from '@/letter/tracking/copy';
import type { Country, PaperKind, WaxKind, WaxType } from '@/theme/stationery';

const daysAgo = (n: number, fixed: boolean) =>
  fixed ? `2026-10-${String(24 - n).padStart(2, '0')}` : new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/**
 * Where the other senders put their seals (DL envelopes): along the flap's left edge, a
 * decorative one low on the body (knife only), the right edge with the die off-centre and
 * a drop, deep on the flap (knife only), the tip. Each with its own die.
 */
function variedSeal(i: number, seed: number): { seal: SealPlacement; die: SealDie } {
  const k = (i - 1) % 5;
  if (k === 0) {
    const p = presetSeal('left', 'DL', seed);
    return { seal: { ...p, stamp: p.stamp && { ...p.stamp, rot: 0.35 } }, die: 'swallow' };
  }
  if (k === 1) {
    const p = presetSeal('body', 'DL', seed);
    return { seal: { ...p, stamp: p.stamp && { ...p.stamp, rot: -0.2 } }, die: 'heart' };
  }
  if (k === 2) {
    // On the right V edge, poured a little smaller and steered down-right, pressed a bit late.
    const base = presetSeal('tip', 'DL', seed);
    const x = 0.72;
    const y = (FLAP_TIP * (1 - x)) / (1 - tipFraction(seed));
    const seal = parseSeal({
      ...base,
      x,
      y,
      rMm: 15,
      stretch: [0.22, 0.12],
      drops: [[x + 0.075, y + 0.12, 1.6]],
      stamp: base.stamp && { ...base.stamp, x: x + 0.012, y: y + 0.01, rot: 0.5, depth: 0.6 },
    });
    return { seal: seal ?? base, die: 'lily' };
  }
  if (k === 3) return { seal: presetSeal('flap', 'DL', seed), die: 'bee' };
  const p = presetSeal('tip', 'DL', seed);
  return { seal: { ...p, stamp: p.stamp && { ...p.stamp, rot: 0.12 } }, die: 'moon' };
}

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
      liner: 'postal',
      die: 'monogram',
      ...(i > 0 ? variedSeal(i, seed + i * 977) : {}),
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

/** Re-reading skips the ceremony: the unfolded sheet, straight away. */
function Reread({ letter, lang, onBack }: { letter: MailLetter; lang: Country; onBack: () => void }) {
  const { width: sw } = useWindowDimensions();
  const ew = Math.round(Math.min(Math.min(sw, 480) - 40, 360));
  const sheet = { width: Math.round(ew * 0.93), height: Math.round(ew * 0.93 * SHEET_RATIO) };
  const copy = MAILBOX_COPY[lang];
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
        fold={letter.fold}
      />
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
  // The first letter's seal from the QA params (?hold=left|flap|body|tip, sx, sy, kx, ky, rot, depth, die);
  // without them it is an old letter: no seal recorded, today's seal on the tip.
  const { sx, sy, kx, ky, rot, depth, hold, die } = q;
  const letters = useMemo(() => {
    const seed = q.seed ?? 1407;
    const list = lettersFor(country, total, seed, fixed, q.wax === 'flexible' ? 'flexible' : 'brittle');
    if (!list[0]) return list;
    const format = fold ? formatForFold(fold) : undefined;
    const seal = sealFromParams({ sx, sy, kx, ky, rot, depth, hold }, format ?? 'DL', seed);
    const first: MailLetter = {
      ...list[0],
      ...(fold ? { fold, format } : {}),
      ...(seal ? { seal } : {}),
      ...(die ? { die: parseDie(die) } : {}),
    };
    return [first, ...list.slice(1)];
  }, [country, total, q.seed, fixed, q.wax, fold, sx, sy, kx, ky, rot, depth, hold, die]);
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

const styles = StyleSheet.create({
  link: { color: '#8f806b', fontSize: 12, textDecorationLine: 'underline' },
  linkLight: { color: '#e4d6bf', fontSize: 14, textDecorationLine: 'underline', paddingVertical: 4 },
  note: { color: '#b9a88f', fontSize: 13 },
  extra: { alignItems: 'center', gap: 10 },
  shoebox: { alignItems: 'center', gap: 2 },
  shoeboxTitle: { color: '#b9a88f', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
});
