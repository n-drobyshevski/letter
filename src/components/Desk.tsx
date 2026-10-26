import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DESK } from '../theme/stationery';

/** The desk every scene sits on: dark wood, warm lamp, no system chrome. */
export function Desk({ title, hint, children, scroll = true }: { title?: string; hint?: string; children: ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  const body = (
    <>
      {title && <Text style={styles.title}>{title}</Text>}
      {hint && <Text style={styles.hint}>{hint}</Text>}
      {children}
    </>
  );
  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      {scroll ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>{body}</ScrollView>
      ) : (
        <View style={styles.content}>{body}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: DESK.background },
  content: { alignItems: 'center', paddingHorizontal: 16, gap: 12 },
  title: { color: '#efe2cc', fontSize: 22, fontFamily: 'MarckScript_400Regular', marginTop: 4 },
  hint: { color: '#b9a88f', fontSize: 13, textAlign: 'center', maxWidth: 420 },
});
