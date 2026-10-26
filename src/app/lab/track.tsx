import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Choice } from '@/components/Choice';
import { Desk } from '@/components/Desk';
import { useLabParams } from '@/lib/params';
import { TrackingMap } from '@/letter/TrackingMap';
import { TrackingTimeline } from '@/letter/TrackingTimeline';
import { shortDate, clock, type Lang } from '@/letter/tracking/copy';
import { generateItinerary, nextDeliveryRound, routeLengthKm, zoned, type Tier } from '@/letter/tracking/itinerary';

/**
 * Lab: one letter from Lille to Minsk, with a fake clock. The real app gets the
 * itinerary from the server (post-letter function) and only the scans up to now.
 */

const TIERS = [
  { key: 'postal', label: 'Как настоящая' },
  { key: 'standard', label: 'Обычное' },
  { key: 'express', label: 'Экспресс' },
] as const;
const VIEWERS = [
  { key: 'sender', label: 'Lille (FR)' },
  { key: 'recipient', label: 'Минск (RU)' },
] as const;

// Posted on Tuesday 27 October 2026; the grace window ends at 15:30 in Lille.
const COLLECT = new Date(zoned(2026, 10, 27, 15.5, 'Europe/Paris'));
const HOUR = 3600e3;

export default function TrackLab() {
  const q = useLabParams();
  const { width: sw } = useWindowDimensions();
  const wide = sw >= 900;
  const mapWidth = Math.round(wide ? Math.min(sw * 0.58, 820) : Math.min(sw, 520));

  const [tier, setTier] = useState<Tier>((q.tier as Tier) ?? 'postal');
  const [viewer, setViewer] = useState<'sender' | 'recipient'>(q.viewer === 'sender' ? 'sender' : 'recipient');
  const [seed, setSeed] = useState(q.seed ?? 1407);
  const [hours, setHours] = useState((q.day ?? 6) * 24);

  const itinerary = useMemo(() => {
    if (tier === 'postal') return generateItinerary({ seed, collectAt: COLLECT, tier });
    // As compute_deliver_at does: express = next round ≥ 2 h; standard = 12–72 h by distance, then the next round.
    const lead = tier === 'express' ? 2 : Math.min(72, Math.max(12, routeLengthKm() / 40));
    const deliverAt = nextDeliveryRound(new Date(COLLECT.getTime() + lead * HOUR));
    return generateItinerary({ seed, collectAt: COLLECT, tier, deliverAt });
  }, [seed, tier]);

  const end = Date.parse(itinerary.deliverAt);
  const now = new Date(Math.min(COLLECT.getTime() + hours * HOUR, end + 6 * HOUR));
  const lang: Lang = viewer === 'sender' ? 'fr' : 'ru';
  const viewerTz = viewer === 'sender' ? 'Europe/Paris' : 'Europe/Minsk';
  const step = (h: number) => setHours((v) => Math.max(0, Math.min(v + h, (end - COLLECT.getTime()) / HOUR + 6)));

  const map = <TrackingMap itinerary={itinerary} now={now} width={mapWidth} lang={lang} />;
  const timeline = (
    <TrackingTimeline itinerary={itinerary} now={now} lang={lang} viewerTz={viewerTz} recipientTz="Europe/Minsk" />
  );

  return (
    <Desk title={lang === 'ru' ? 'Где письмо?' : 'Où est ma lettre ?'} hint="Lille → Минск">
      <View style={styles.controls}>
        <Choice options={TIERS} value={tier} onChange={setTier} />
        <Choice options={VIEWERS} value={viewer} onChange={setViewer} />
        <View style={styles.clock}>
          <Step label="−1 д" onPress={() => step(-24)} />
          <Text style={styles.now}>
            {shortDate(now.getTime(), viewerTz, lang)} {clock(now.getTime(), viewerTz)}
          </Text>
          <Step label="+6 ч" onPress={() => step(6)} />
          <Step label="+1 д" onPress={() => step(24)} />
          <Step label="→ ✉" onPress={() => setHours((end - COLLECT.getTime()) / HOUR + 1)} />
        </View>
        <Pressable onPress={() => setSeed((s) => (s * 1103515245 + 12345) % 2147483647)}>
          <Text style={styles.link}>Другое письмо · seed {seed}</Text>
        </Pressable>
      </View>
      {wide ? (
        <View style={styles.wide}>
          {map}
          <View style={styles.side}>{timeline}</View>
        </View>
      ) : (
        <>
          <View style={styles.mapWrap}>{map}</View>
          {timeline}
        </>
      )}
    </Desk>
  );
}

function Step({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.step} accessibilityRole="button">
      <Text style={styles.stepText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  controls: { gap: 6, alignItems: 'center' },
  clock: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  now: { color: '#efe2cc', fontSize: 14, minWidth: 110, textAlign: 'center' },
  step: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 3, backgroundColor: '#4a3a2e' },
  stepText: { color: '#e4d6bf', fontSize: 13 },
  link: { color: '#b9a88f', fontSize: 12, textDecorationLine: 'underline' },
  mapWrap: { marginHorizontal: -16 },
  wide: { flexDirection: 'row', gap: 20, alignItems: 'flex-start' },
  side: { width: 400 },
});
