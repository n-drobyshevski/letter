import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Choice } from '@/components/Choice';
import { Desk } from '@/components/Desk';
import { SignIn } from '@/components/SignIn';
import { draftBody, isEmptyDraft, setDraft, useDraft, type Draft } from '@/lib/draft';
import { postLetter, retrieveLetter, useCouple, useLettersInTransit, useSession, type Couple } from '@/lib/mail';
import { useLabParams } from '@/lib/params';
import { supabase } from '@/lib/supabase';
import { useMotionPrefs } from '@/lib/useMotionPrefs';
import type { EnvelopeLook } from '@/letter/EnvelopeCeremony';
import { PostingCeremony } from '@/letter/PostingCeremony';
import { promiseLine, type LetterRow } from '@/letter/tracking/fromServer';
import { routed, type Tier } from '@/letter/tracking/itinerary';
import type { Lang } from '@/letter/tracking/copy';
import type { Country, PostboxSkin } from '@/theme/stationery';

/**
 * Posting a letter. Two modes:
 *  - live (a Supabase project is configured and you are signed in): the letter you
 *    wrote on the desk goes through the post-letter function, which decides the
 *    collection and delivery times and, France → Belarus, its whole journey;
 *  - lab (no backend, or "без отправки"): the same ceremony, nothing is sent.
 */

type State = 'ready' | 'sending' | 'posted' | 'collected';
const LAB_TIERS = [
  { key: 'blue', label: 'Обычное' },
  { key: 'yellow', label: 'Экспресс' },
] as const;

const COUNTRIES = [
  { key: 'ru', label: 'Россия' },
  { key: 'fr', label: 'France' },
] as const;

const HOUR = 3600e3;
const clock = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

/** UI copy follows the sender's language (RU/FR), informal ты/tu. */
const COPY = {
  ru: {
    title: 'Почтовый ящик',
    ready: 'Опусти письмо в ящик: потяни вверх',
    sending: 'Письмо падает в ящик…',
    posted: (t: string) => `Письмо в ящике. Можно забрать до ${t}`,
    collected: (express: boolean) => `Письмо забрали. Оно в пути: придёт ${express ? 'сегодня к 16:00' : 'завтра около 10:00'}`,
    collectedLive: (promise: string) => `Письмо забрали, оно в пути. ${promise}`,
    post: 'Опустить',
    retrieve: 'Забрать письмо',
    lab: '(лаб) выемка прошла',
    tiers: {
      postal: 'Как настоящая',
      standard: 'Обычное',
      express: 'Экспресс',
      scheduled: 'К дате',
    },
    write: 'Сначала напиши письмо',
    toDesk: 'За стол →',
    empty: 'Конверт пустой: сначала напиши письмо',
    refused: (why: string) => `Ящик не принял письмо: ${why}`,
    tooLate: 'Поздно: письмо уже забрали',
    track: 'Где письмо? →',
    transit: 'В пути',
    offline: 'без отправки (лаб)',
    signOut: 'выйти',
  },
  fr: {
    title: 'Boîte aux lettres',
    ready: 'Glisse la lettre dans la boîte : tire vers le haut',
    sending: 'La lettre tombe dans la boîte…',
    posted: (t: string) => `La lettre est dans la boîte. Tu peux la reprendre jusqu'à ${t.replace(':', ' h ')}`,
    collected: () => 'La lettre est partie. Elle est en route : arrivée demain vers 10 h',
    collectedLive: (promise: string) => `La lettre est partie. ${promise}`,
    post: 'Poster',
    retrieve: 'Reprendre la lettre',
    lab: '(lab) levée passée',
    tiers: {
      postal: 'Comme la vraie poste',
      standard: 'Normale',
      express: 'Express',
      scheduled: 'À une date',
    },
    write: 'Écris d’abord ta lettre',
    toDesk: 'À ton bureau →',
    empty: 'L’enveloppe est vide : écris d’abord ta lettre',
    refused: (why: string) => `La boîte n’a pas pris la lettre : ${why}`,
    tooLate: 'Trop tard : la lettre est déjà partie',
    track: 'Où est ma lettre ? →',
    transit: 'En route',
    offline: 'sans envoyer (lab)',
    signOut: 'se déconnecter',
  },
};

export default function PostScreen() {
  const session = useSession();
  const [offline, setOffline] = useState(false);
  const { couple, error } = useCouple(session?.user.id);

  if (!supabase || offline) return <PostLab />;
  if (session === undefined)
    return (
      <Desk title="…" scroll={false}>
        {null}
      </Desk>
    );
  if (!session) {
    return (
      <Desk title="Почта · La Poste">
        <SignIn />
        <Pressable onPress={() => setOffline(true)}>
          <Text style={styles.lab}>без отправки (лаб) · sans envoyer (lab)</Text>
        </Pressable>
      </Desk>
    );
  }
  if (!couple)
    return (
      <Desk title="…" hint={error ?? undefined} scroll={false}>
        {null}
      </Desk>
    );
  return <LivePost couple={couple} onOffline={() => setOffline(true)} />;
}

/** The real thing: the draft from the desk, posted through post-letter. */
function LivePost({ couple, onOffline }: { couple: Couple; onOffline: () => void }) {
  const { width: sw, height: sh } = useWindowDimensions();
  const width = Math.min(sw, 480);
  // Room below for the tier tags, the letters in transit and the account links.
  const height = Math.round(Math.min(sh - 300, 640));
  const { me, them } = couple;
  const lang: Lang = me.locale;
  const copy = COPY[lang];
  // The box you stand in front of is the one where you live.
  const country: Country = me.tz === 'Europe/Paris' ? 'fr' : 'ru';
  const hasRoute = routed(me.tz, them?.tz);
  const tiers = (hasRoute ? (['postal', 'standard', 'express'] as const) : (['standard', 'express'] as const)).map((key) => ({
    key,
    label: copy.tiers[key],
  }));

  const draft = useDraft();
  const [tier, setTier] = useState<Tier>(hasRoute ? 'postal' : 'standard');
  const skin: PostboxSkin = tier === 'express' ? 'yellow' : 'blue';
  const [state, setState] = useState<State>('ready');
  const [letter, setLetter] = useState<LetterRow | null>(null);
  // A notice is about one draft ("the envelope is empty", "refused"): writing again clears it.
  const [notice, setNotice] = useState<{ text: string; about: Draft | null } | null>(null);
  const [commitKey, setCommitKey] = useState(0);
  const [retrieveKey, setRetrieveKey] = useState(0);
  const [transitKey, setTransitKey] = useState(0);
  const transit = useLettersInTransit(me.id, transitKey);
  // The sticker shows the next collection; the server's own time replaces it once posted.
  const [expected] = useState(() => clock(new Date(Date.now() + HOUR)));
  const collectAt = letter ? clock(new Date(letter.collect_at)) : expected;
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const { needsButtons } = useMotionPrefs();
  const look: EnvelopeLook = {
    paper: 'cream',
    liner: 'postal',
    wax: 'bordeaux',
    initials: me.display_name.trim().charAt(0).toUpperCase() || (lang === 'fr' ? 'M' : 'Н'),
    seed,
  };

  // The postman comes at collect_at: from then on the letter is gone.
  useEffect(() => {
    if (state !== 'posted' || !letter) return;
    const wait = Date.parse(letter.collect_at) - Date.now();
    const timer = setTimeout(
      () => {
        setState('collected');
        setTransitKey((k) => k + 1);
        // It is on its way now: the desk starts a fresh sheet.
        setDraft(null);
      },
      Math.max(0, wait),
    );
    return () => clearTimeout(timer);
  }, [state, letter]);

  const bounce = (message: string) => {
    setNotice({ text: message, about: draft });
    setRetrieveKey((k) => k + 1);
  };

  const onPosted = async () => {
    if (isEmptyDraft(draft)) return bounce(copy.empty);
    setState('sending');
    setNotice(null);
    try {
      const row = await postLetter({
        tier,
        body: draftBody(draft!),
        envelope: { ...look },
        seed,
      });
      setLetter(row);
      setState('posted');
    } catch (e) {
      setState('ready');
      bounce(copy.refused(e instanceof Error ? e.message : String(e)));
    }
  };

  const retrieve = async () => {
    if (!letter) return;
    try {
      await retrieveLetter(letter.id);
      setRetrieveKey((k) => k + 1);
    } catch {
      setNotice({ text: copy.tooLate, about: null });
      setState('collected');
      setDraft(null);
    }
  };

  const onRetrieved = () => {
    // Back in your hand; the draft is still there. A new posting is a new envelope.
    if (letter) {
      setLetter(null);
      setSeed((s) => (s * 1103515245 + 12345) % 2147483647);
      setTransitKey((k) => k + 1);
    }
    setState('ready');
  };

  const promise = letter && them ? promiseLine(letter, lang, them.tz) : '';
  const hint =
    (notice && notice.about === draft ? notice.text : null) ??
    {
      ready: isEmptyDraft(draft) ? copy.write : copy.ready,
      sending: copy.sending,
      posted: copy.posted(collectAt),
      collected: copy.collectedLive(promise),
    }[state];

  return (
    <Desk title={copy.title} hint={hint} scroll={false}>
      {state === 'ready' && (
        <View style={styles.choices}>
          <Choice options={tiers} value={tier} onChange={setTier} />
          {isEmptyDraft(draft) && (
            <Link href="/write" style={styles.link}>
              {copy.toDesk}
            </Link>
          )}
        </View>
      )}
      <View style={styles.stage}>
        <PostingCeremony
          width={width}
          height={height}
          look={look}
          skin={skin}
          country={country}
          collectAt={collectAt}
          commitKey={commitKey}
          retrieveKey={retrieveKey}
          onPosted={onPosted}
          onRetrieved={onRetrieved}
        />
      </View>
      <View style={styles.actions}>
        {state === 'ready' && (
          <Button label={copy.post} quiet={!needsButtons} onPress={() => setCommitKey((k) => k + 1)} />
        )}
        {state === 'posted' && <Button label={copy.retrieve} onPress={retrieve} />}
        {(state === 'posted' || state === 'collected') && letter?.tracking && (
          <Link href={`/track/${letter.id}`} style={styles.link}>
            {copy.track}
          </Link>
        )}
        {state === 'ready' && transit.length > 0 && (
          <View style={styles.transit}>
            <Text style={styles.transitTitle}>{copy.transit}</Text>
            {transit.map((l) => (
              <TransitRow
                key={l.id}
                letter={l}
                mine={l.sender_id === me.id}
                lang={lang}
                tz={l.sender_id === me.id ? (them?.tz ?? me.tz) : me.tz}
              />
            ))}
          </View>
        )}
        {state === 'ready' && (
          <View style={styles.row}>
            <Pressable onPress={onOffline}>
              <Text style={styles.lab}>{copy.offline}</Text>
            </Pressable>
            <Pressable onPress={() => supabase?.auth.signOut()}>
              <Text style={styles.lab}>{copy.signOut}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Desk>
  );
}

function TransitRow({ letter, mine, lang, tz }: { letter: LetterRow; mine: boolean; lang: Lang; tz: string }) {
  const line = `${mine ? '→' : '←'} ${promiseLine(letter, lang, tz)}`;
  if (!letter.tracking) return <Text style={styles.transitRow}>{line}</Text>;
  return (
    <Link href={`/track/${letter.id}`} style={[styles.transitRow, styles.underline]}>
      {line}
    </Link>
  );
}

/** No backend: the ceremony on its own, with a fake collection. */
function PostLab() {
  const q = useLabParams();
  const { width: sw, height: sh } = useWindowDimensions();
  const width = Math.min(sw, 480);
  const height = Math.round(Math.min(sh - 190, 640));
  const [skin, setSkin] = useState<PostboxSkin>('blue');
  const [country, setCountry] = useState<Country>(q.country === 'fr' ? 'fr' : 'ru');
  const copy = COPY[country];
  const [state, setState] = useState<State>('ready');
  const [commitKey, setCommitKey] = useState(0);
  const [retrieveKey, setRetrieveKey] = useState(0);
  const [collectAt] = useState(() => (q.t !== undefined ? '14:37' : clock(new Date(Date.now() + HOUR))));
  const { needsButtons } = useMotionPrefs();
  const look: EnvelopeLook = {
    paper: 'cream',
    liner: 'postal',
    wax: 'bordeaux',
    initials: country === 'fr' ? 'M' : 'Н',
    seed: q.seed ?? 1407,
  };

  const hint = {
    ready: copy.ready,
    sending: copy.sending,
    posted: copy.posted(collectAt),
    collected: copy.collected(skin === 'yellow'),
  }[state];

  return (
    <Desk title={copy.title} hint={hint} scroll={false}>
      {state === 'ready' && (
        <View style={styles.choices}>
          <Choice options={COUNTRIES} value={country} onChange={setCountry} />
          {country === 'ru' && <Choice options={LAB_TIERS} value={skin} onChange={setSkin} />}
        </View>
      )}
      <View style={styles.stage}>
        <PostingCeremony
          width={width}
          height={height}
          look={look}
          skin={skin}
          country={country}
          collectAt={collectAt}
          fixedT={q.t}
          commitKey={commitKey}
          retrieveKey={retrieveKey}
          onPosted={() => setState('posted')}
          onRetrieved={() => setState('ready')}
        />
      </View>
      <View style={styles.actions}>
        {/* Every gesture has a tap alternative; it leads when Reduce Motion or a screen reader is on. */}
        {state === 'ready' && (
          <Button label={copy.post} quiet={!needsButtons} onPress={() => setCommitKey((k) => k + 1)} />
        )}
        {state === 'posted' && (
          <>
            <Button label={copy.retrieve} onPress={() => setRetrieveKey((k) => k + 1)} />
            <Pressable onPress={() => setState('collected')}>
              <Text style={styles.lab}>{copy.lab}</Text>
            </Pressable>
          </>
        )}
      </View>
    </Desk>
  );
}

function Button({ label, onPress, quiet = false }: { label: string; onPress: () => void; quiet?: boolean }) {
  return (
    <Pressable onPress={onPress} style={quiet ? styles.quiet : styles.button} accessibilityRole="button">
      <Text style={quiet ? styles.lab : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stage: { marginHorizontal: -16 },
  choices: { gap: 6, alignItems: 'center' },
  actions: { alignItems: 'center', gap: 8, minHeight: 44 },
  row: { flexDirection: 'row', gap: 16 },
  button: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 3, backgroundColor: '#efe2cc' },
  buttonText: { color: '#2a211b', fontSize: 15 },
  quiet: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  lab: { color: '#8f806b', fontSize: 12, textDecorationLine: 'underline' },
  link: { color: '#e4d6bf', fontSize: 14, textDecorationLine: 'underline' },
  transit: { alignItems: 'center', gap: 4 },
  transitTitle: {
    color: '#b9a88f',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  transitRow: { color: '#e4d6bf', fontSize: 13 },
  underline: { textDecorationLine: 'underline' },
});
