import { StyleSheet, Text, View } from 'react-native';

import { clock, note, official, shortDate, silenceLine, windowLine, type Lang } from './tracking/copy';
import type { Itinerary } from './tracking/itinerary';

/**
 * The tracking slip: a printed card, newest scan first. Each scan has the official
 * line (in the language of the post office that made it), a handwritten note in the
 * viewer's language, and the time where it happened next to the viewer's own time.
 */

type Props = {
  itinerary: Itinerary;
  now: Date;
  lang: Lang;
  /** The viewer's time zone, for "у тебя 12:32". */
  viewerTz: string;
  recipientTz: string;
};

const TITLE: Record<Lang, string> = { ru: 'Заказное международное письмо', fr: 'Lettre recommandée internationale' };
const YOURS: Record<Lang, string> = { ru: 'у тебя', fr: 'chez toi' };

export function TrackingTimeline({ itinerary, now, lang, viewerTz, recipientTz }: Props) {
  const t = now.getTime();
  const seen = itinerary.events.filter((e) => e.visible && Date.parse(e.at) <= t).reverse();
  const silence = seen.length ? silenceLine(seen[0], t, lang) : null;

  return (
    <View style={styles.card} accessibilityRole="list">
      <Text style={styles.title}>{TITLE[lang]}</Text>
      <Text style={styles.number} accessibilityLabel={itinerary.s10.replace(/ /g, '')}>
        {itinerary.s10}
      </Text>
      <Barcode value={itinerary.s10} />
      <Text style={styles.window}>{windowLine(itinerary, lang, recipientTz)}</Text>
      <View style={styles.rule} />

      {silence && (
        <View style={styles.row}>
          <View style={styles.when} />
          <Text style={[styles.note, styles.silence]}>{silence}</Text>
        </View>
      )}
      {seen.map((e) => {
        const at = Date.parse(e.at);
        const line = official(e.code);
        const here = clock(at, e.place.tz);
        const mine = clock(at, viewerTz);
        return (
          <View key={e.seq} style={styles.row} accessible>
            <View style={styles.when}>
              <Text style={styles.date}>{shortDate(at, e.place.tz, lang)}</Text>
              <Text style={styles.time}>{here}</Text>
            </View>
            <View style={styles.what}>
              {line && <Text style={styles.official}>{line.text}</Text>}
              <Text style={styles.office}>
                {[e.office, e.place.name[lang]].filter(Boolean).join(' · ')}
                {here !== mine ? `  (${YOURS[lang]} ${mine})` : ''}
              </Text>
              <Text style={styles.note}>{note(e.code, lang)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** A decorative barcode derived from the S10 number (not a scannable symbology). */
function Barcode({ value }: { value: string }) {
  const digits = value.replace(/\D/g, '');
  const bars: number[] = [];
  for (const ch of `0${digits}0`) {
    const d = Number(ch);
    bars.push(1 + (d % 3), 1 + ((d >> 1) % 2), 2 + (d % 2), 1);
  }
  return (
    <View style={styles.barcode} importantForAccessibility="no-hide-descendants">
      {bars.map((w, i) => (
        <View key={i} style={{ width: w, height: 22, backgroundColor: i % 2 ? 'transparent' : '#222' }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#f6f1e6',
    borderRadius: 2,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#140c04',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 2, height: 4 },
    elevation: 4,
  },
  title: { fontFamily: 'PTSansNarrow_700Bold', fontSize: 13, letterSpacing: 1.2, color: '#3a3346', textTransform: 'uppercase' },
  number: { fontFamily: 'PTSansNarrow_700Bold', fontSize: 18, letterSpacing: 2, color: '#1d1a24', marginTop: 4 },
  barcode: { flexDirection: 'row', marginTop: 4, marginBottom: 2 },
  window: { fontFamily: 'Caveat_400Regular', fontSize: 22, color: '#1f2b4d', marginTop: 6 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: '#8b7f6e', marginVertical: 10 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 7 },
  when: { width: 52 },
  date: { fontFamily: 'PTSansNarrow_700Bold', fontSize: 13, color: '#3a3346' },
  time: { fontFamily: 'PTSansNarrow_400Regular', fontSize: 13, color: '#6a6276' },
  what: { flex: 1 },
  official: { fontFamily: 'PTSansNarrow_400Regular', fontSize: 14, color: '#22202a' },
  office: { fontFamily: 'PTSansNarrow_700Bold', fontSize: 11, letterSpacing: 0.6, color: '#6a6276', marginTop: 1 },
  note: { fontFamily: 'Caveat_400Regular', fontSize: 19, color: '#1f2b4d', marginTop: 1 },
  silence: { flex: 1, color: '#5d5566' },
});
