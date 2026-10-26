import { Link, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Desk } from '@/components/Desk';
import { SignIn } from '@/components/SignIn';
import { isEmptyDraft, useDraft } from '@/lib/draft';
import { useCouple, useLettersInTransit, useMailbox, useSession, type Couple } from '@/lib/mail';
import { supabase } from '@/lib/supabase';
import { promiseLine } from '@/letter/tracking/fromServer';
import { plural, shortDate, type Lang } from '@/letter/tracking/copy';
import { HANDWRITING_FONTS } from '@/theme/stationery';

import LabIndex from './lab/index';

/** UI copy follows the reader, informal ты/tu. */
const COPY = {
  ru: {
    title: 'Письма',
    box: (n: number) => (n === 0 ? 'Ящик пуст' : `В ящике ${n} ${plural(n, 'письмо', 'письма', 'писем')}`),
    from: (name: string, date: string) => `от ${name} · ${date}`,
    noMail: 'Писем пока нет',
    write: 'Написать письмо',
    to: (name: string) => `для ${name}`,
    noPartner: 'Второй ящик ещё не открыт',
    onDesk: 'Письмо на столе',
    keepWriting: 'Дописать',
    takeToPost: 'Отнести на почту',
    onTheWay: 'В пути',
    read: (n: number) => `Прочитанные: ${n}`,
    signOut: 'выйти',
    lab: 'лаборатория',
  },
  fr: {
    title: 'Lettres',
    box: (n: number) => (n === 0 ? 'Ta boîte est vide' : n === 1 ? 'Une lettre t’attend' : `${n} lettres t’attendent`),
    from: (name: string, date: string) => `de ${name} · ${date}`,
    noMail: 'Pas de courrier pour l’instant',
    write: 'Écrire une lettre',
    to: (name: string) => `pour ${name}`,
    noPartner: 'L’autre boîte n’est pas encore ouverte',
    onDesk: 'Une lettre sur ton bureau',
    keepWriting: 'Continuer',
    takeToPost: 'Poster',
    onTheWay: 'En route',
    read: (n: number) => `Déjà lues : ${n}`,
    signOut: 'se déconnecter',
    lab: 'labo',
  },
};

/** The app's front door. Without a backend it is the lab index. */
export default function Home() {
  const session = useSession();
  const { couple, error } = useCouple(session?.user.id);

  if (!supabase) return <LabIndex />;
  if (session === undefined) return <Desk title="Письма">{null}</Desk>;
  if (!session) {
    return (
      <Desk title="Письма · Lettres" hint="Почта для двоих · Le courrier à deux">
        <SignIn />
        <Link href="/lab" style={styles.footLink}>
          лаборатория · labo
        </Link>
      </Desk>
    );
  }
  if (!couple) return <Desk title="Письма" hint={error ?? undefined}>{null}</Desk>;
  return <HomeDesk couple={couple} />;
}

function HomeDesk({ couple }: { couple: Couple }) {
  const { me, them } = couple;
  const lang: Lang = me.locale;
  const copy = COPY[lang];

  // Coming back from the mailbox or the post office: read everything again.
  const [visit, setVisit] = useState(0);
  useFocusEffect(useCallback(() => setVisit((v) => v + 1), []));
  const box = useMailbox(couple, visit);
  const transit = useLettersInTransit(me.id, visit);
  const draft = useDraft();

  const today = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: me.tz,
  }).format(new Date());

  const waiting = box.waiting.length;
  const first = box.waiting[0];
  const incoming = transit.find((l) => l.recipient_id === me.id);
  const mailNote = first
    ? copy.from(first.fromLabel.name, shortDate(Date.parse(first.deliverAt!), me.tz, lang))
    : incoming
      ? promiseLine(incoming, lang, me.tz)
      : copy.noMail;

  return (
    <Desk title={copy.title} hint={`${me.city} · ${today}`}>
      <Card href="/mailbox" label={copy.box(waiting)}>
        <View style={styles.row}>
          <View style={styles.grow}>
            <Text style={styles.cardTitle}>{copy.box(waiting)}</Text>
            {box.loaded && <Text style={styles.cardNote}>{mailNote}</Text>}
          </View>
          <Flag up={waiting > 0} />
        </View>
      </Card>

      {!isEmptyDraft(draft) ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{copy.onDesk}</Text>
          <Text style={styles.excerpt} numberOfLines={2}>
            {draft!.text.trim() || '✎'}
          </Text>
          <View style={styles.actions}>
            <Link href="/write" style={styles.action}>
              {copy.keepWriting}
            </Link>
            {them && (
              <Link href="/post" style={[styles.action, styles.primary]}>
                {copy.takeToPost} →
              </Link>
            )}
          </View>
        </View>
      ) : (
        <Card href="/write" label={copy.write}>
          <Text style={styles.cardTitle}>{copy.write}</Text>
          <Text style={styles.cardNote}>{them ? copy.to(them.display_name) : copy.noPartner}</Text>
        </Card>
      )}

      {transit.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{copy.onTheWay}</Text>
          {transit.map((l) => {
            const mine = l.sender_id === me.id;
            const line = `${mine ? '→' : '←'} ${them?.display_name ?? ''} · ${promiseLine(l, lang, mine ? (them?.tz ?? me.tz) : me.tz)}`;
            return l.tracking ? (
              <Link key={l.id} href={`/track/${l.id}`} style={styles.transit}>
                {line}
              </Link>
            ) : (
              <Text key={l.id} style={[styles.transit, styles.plain]}>
                {line}
              </Text>
            );
          })}
        </View>
      )}

      {box.opened.length > 0 && (
        <Link href="/mailbox" style={styles.footLink}>
          {copy.read(box.opened.length)}
        </Link>
      )}
      <View style={styles.foot}>
        <Pressable onPress={() => supabase?.auth.signOut()}>
          <Text style={styles.footLink}>{copy.signOut}</Text>
        </Pressable>
        <Link href="/lab" style={styles.footLink}>
          {copy.lab}
        </Link>
      </View>
    </Desk>
  );
}

function Card({ href, label, children }: { href: Href; label: string; children: ReactNode }) {
  return (
    <Link href={href} asChild>
      <Pressable style={styles.card} accessibilityRole="link" accessibilityLabel={label}>
        {children}
      </Pressable>
    </Link>
  );
}

/** The mailbox flag: raised when something is waiting. */
function Flag({ up }: { up: boolean }) {
  return (
    <View style={styles.flagBox} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.pole} />
      <View style={[styles.flag, up ? styles.flagUp : styles.flagDown]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 520,
    padding: 16,
    borderRadius: 2,
    backgroundColor: '#f3ece0',
    shadowColor: '#140c04',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 2, height: 4 },
    elevation: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1 },
  cardTitle: { fontFamily: 'BadScript_400Regular', fontSize: 24, color: '#1f2b4d' },
  cardNote: { fontSize: 13, color: '#5a4c3e', marginTop: 4 },
  excerpt: { fontFamily: HANDWRITING_FONTS.badScript.family, fontSize: 16, color: '#2a3555', marginTop: 6, opacity: 0.85 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  action: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 3,
    backgroundColor: '#e6dac6',
    color: '#2a211b',
    fontSize: 14,
    overflow: 'hidden',
  },
  primary: { backgroundColor: '#2a211b', color: '#efe2cc' },
  section: { width: '100%', maxWidth: 520, gap: 6, paddingHorizontal: 4 },
  sectionTitle: { color: '#b9a88f', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  transit: { color: '#e4d6bf', fontSize: 14, textDecorationLine: 'underline', paddingVertical: 4 },
  plain: { textDecorationLine: 'none' },
  foot: { flexDirection: 'row', gap: 18, marginTop: 8 },
  footLink: { color: '#8f806b', fontSize: 12, textDecorationLine: 'underline' },
  flagBox: { width: 30, height: 36 },
  pole: { position: 'absolute', left: 4, bottom: 0, width: 3, height: 34, borderRadius: 1, backgroundColor: '#6f6656' },
  flag: { position: 'absolute', left: 7, width: 20, height: 13, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  flagUp: { bottom: 21, backgroundColor: '#b3261e' },
  flagDown: { bottom: 0, backgroundColor: '#8a8170' },
});
