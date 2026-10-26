import { Pressable, StyleSheet, Text, View } from 'react-native';

/** A row of small paper tags to pick one option. */
export function Choice<K extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <View style={styles.row}>
      {options.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => onChange(o.key)}
          style={[styles.tag, o.key === value && styles.active]}
          accessibilityRole="button"
          accessibilityState={{ selected: o.key === value }}
        >
          <Text style={[styles.label, o.key === value && styles.activeLabel]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 3, backgroundColor: '#4a3a2e' },
  active: { backgroundColor: '#efe2cc' },
  label: { color: '#e4d6bf', fontSize: 13 },
  activeLabel: { color: '#2a211b' },
});
