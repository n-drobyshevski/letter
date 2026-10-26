import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Desk } from '@/components/Desk';
import { SignIn } from '@/components/SignIn';
import { useCouple, useSession, useTracking } from '@/lib/mail';
import { supabase } from '@/lib/supabase';
import { TrackingView } from '@/letter/TrackingView';
import { promiseLine } from '@/letter/tracking/fromServer';

const TITLE = { ru: 'Где письмо?', fr: 'Où est ma lettre ?' };
const ROUTE = { ru: 'Лилль → Минск', fr: 'Lille → Minsk' };
const STILL_IN_BOX = {
  ru: 'Письмо ещё в ящике, выемка в',
  fr: 'La lettre est encore dans la boîte, levée à',
};
const NO_TRACKING = {
  ru: 'У этого письма нет отслеживания.',
  fr: 'Cette lettre n’a pas de suivi.',
};
const RETRIEVED = {
  ru: 'Письмо забрали из ящика: оно никуда не едет.',
  fr: 'La lettre a été reprise : elle ne voyage pas.',
};

/** One real letter's journey: the scans the server has revealed so far, live. */
export default function TrackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const { couple, error: coupleError } = useCouple(session?.user.id);
  const { tracking, error } = useTracking(session ? id : undefined);

  // The silence line and the pencil guess move with the clock.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const every = setInterval(() => setNow(new Date()), 60e3);
    return () => clearInterval(every);
  }, []);

  if (!supabase)
    return (
      <Desk title="Где письмо?" hint="No backend configured: see .env.example. The lab is at /lab/track.">
        {null}
      </Desk>
    );
  if (session === undefined) return <Desk title="…">{null}</Desk>;
  if (!session) {
    return (
      <Desk title="Где письмо? · Où est ma lettre ?">
        <SignIn />
      </Desk>
    );
  }
  if (!couple || !tracking)
    return (
      <Desk title="…" hint={error ?? coupleError ?? undefined}>
        {null}
      </Desk>
    );

  const { me, them } = couple;
  const lang = me.locale;
  const { letter, itinerary, estimate } = tracking;
  const recipientTz = letter.recipient_id === me.id ? me.tz : (them?.tz ?? me.tz);
  const collect = Date.parse(letter.collect_at);
  const hint = letter.retrieved_at
    ? RETRIEVED[lang]
    : now.getTime() < collect
      ? `${STILL_IN_BOX[lang]} ${new Date(collect).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}`
      : ROUTE[lang];

  return (
    <Desk title={TITLE[lang]} hint={hint}>
      {itinerary && !letter.retrieved_at ? (
        <TrackingView
          itinerary={itinerary}
          now={now}
          lang={lang}
          viewerTz={me.tz}
          recipientTz={recipientTz}
          estimate={estimate}
        />
      ) : (
        <Text style={styles.note}>
          {letter.retrieved_at ? '' : `${NO_TRACKING[lang]} ${promiseLine(letter, lang, recipientTz)}`}
        </Text>
      )}
      <Link dismissTo href="/lab/post" style={styles.link}>
        {lang === 'ru' ? '← к почтовому ящику' : '← à la boîte aux lettres'}
      </Link>
    </Desk>
  );
}

const styles = StyleSheet.create({
  note: { color: '#e4d6bf', fontSize: 14, textAlign: 'center', maxWidth: 420 },
  link: { color: '#b9a88f', fontSize: 13, textDecorationLine: 'underline' },
});
