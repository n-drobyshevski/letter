import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SealCommandKind } from './EnvelopeCeremony';
import { SEAL_COPY } from './sealCopy';

const TURN = {
  ru: { rotateLeft: 'Повернуть печать влево', rotateRight: 'Повернуть печать вправо' },
  fr: { rotateLeft: 'Tourner le cachet à gauche', rotateRight: 'Tourner le cachet à droite' },
};

/**
 * The button alternative to every sealing gesture (sealCopy's sealActions): quiet links
 * under the envelope, solid buttons when Reduce Motion or a screen reader is on.
 */
export function SealButtons({
  actions,
  lang,
  quiet,
  onRun,
}: {
  actions: SealCommandKind[];
  lang: 'ru' | 'fr';
  quiet: boolean;
  onRun: (kind: SealCommandKind) => void;
}) {
  if (actions.length === 0) return null;
  return (
    <View style={styles.row}>
      {actions.map((a) => {
        const round = a === 'rotateLeft' || a === 'rotateRight';
        return (
          <Pressable
            key={a}
            onPress={() => onRun(a)}
            style={[quiet ? styles.quiet : styles.tag, round && styles.round]}
            accessibilityRole="button"
            accessibilityLabel={round ? TURN[lang][a] : undefined}
          >
            <Text style={[quiet ? styles.link : styles.tagText, round && styles.roundText]}>{SEAL_COPY[lang].buttons[a]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', alignItems: 'center' },
  tag: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 3, backgroundColor: '#4a3a2e' },
  tagText: { color: '#e4d6bf', fontSize: 14 },
  quiet: { minHeight: 44, paddingHorizontal: 6, justifyContent: 'center' },
  round: { minWidth: 44, alignItems: 'center' },
  roundText: { fontSize: 18, textDecorationLine: 'none' },
  link: { color: '#b9a88f', fontSize: 13, textDecorationLine: 'underline' },
});
