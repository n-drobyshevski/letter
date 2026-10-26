import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { TrackingMap } from './TrackingMap';
import { TrackingTimeline } from './TrackingTimeline';
import type { Lang } from './tracking/copy';
import type { Itinerary } from './tracking/itinerary';

type Props = {
  itinerary: Itinerary;
  now: Date;
  lang: Lang;
  viewerTz: string;
  recipientTz: string;
  /** See TrackingMap: the server's estimate for a real letter, omitted in the lab. */
  estimate?: number | null;
};

/** Map and receipt: side by side on the laptop, stacked on a phone. */
export function TrackingView({ itinerary, now, lang, viewerTz, recipientTz, estimate }: Props) {
  const { width: sw } = useWindowDimensions();
  const wide = sw >= 900;
  const mapWidth = Math.round(wide ? Math.min(sw * 0.58, 820) : Math.min(sw, 520));

  const map = <TrackingMap itinerary={itinerary} now={now} width={mapWidth} lang={lang} estimate={estimate} />;
  const timeline = <TrackingTimeline itinerary={itinerary} now={now} lang={lang} viewerTz={viewerTz} recipientTz={recipientTz} />;

  return wide ? (
    <View style={styles.wide}>
      {map}
      <View style={styles.side}>{timeline}</View>
    </View>
  ) : (
    <>
      <View style={styles.mapWrap}>{map}</View>
      {timeline}
    </>
  );
}

const styles = StyleSheet.create({
  mapWrap: { marginHorizontal: -16 },
  wide: { flexDirection: 'row', gap: 20, alignItems: 'flex-start' },
  side: { width: 400 },
});
