import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Choice } from '@/components/Choice';
import { Desk } from '@/components/Desk';
import { useLabParams } from '@/lib/params';
import { useMotionPrefs } from '@/lib/useMotionPrefs';
import type { EnvelopeLook } from '@/letter/EnvelopeCeremony';
import { PostingCeremony } from '@/letter/PostingCeremony';
import type { PostboxSkin } from '@/theme/stationery';

type State = 'ready' | 'posted' | 'collected';
const TIERS = [
  { key: 'blue', label: 'Обычное' },
  { key: 'yellow', label: 'Экспресс' },
] as const;

const clock = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

export default function PostLab() {
  const q = useLabParams();
  const { width: sw, height: sh } = useWindowDimensions();
  const width = Math.min(sw, 480);
  const height = Math.round(Math.min(sh - 190, 640));
  const [skin, setSkin] = useState<PostboxSkin>('blue');
  const [state, setState] = useState<State>('ready');
  const [commitKey, setCommitKey] = useState(0);
  const [retrieveKey, setRetrieveKey] = useState(0);
  const [collectAt] = useState(() => (q.t !== undefined ? '14:37' : clock(new Date(Date.now() + 60 * 60 * 1000))));
  const { needsButtons } = useMotionPrefs();
  const look: EnvelopeLook = { paper: 'cream', liner: 'postal', wax: 'bordeaux', initials: 'Н', seed: q.seed ?? 1407 };

  const hint = {
    ready: 'Опусти письмо в ящик: потяни вверх',
    posted: `Письмо в ящике. Можно забрать до ${collectAt}`,
    collected: `Письмо забрали. Оно в пути: придёт ${skin === 'yellow' ? 'сегодня к 16:00' : 'завтра около 10:00'}`,
  }[state];

  return (
    <Desk title="Почтовый ящик" hint={hint} scroll={false}>
      {state === 'ready' && <Choice options={TIERS} value={skin} onChange={setSkin} />}
      <View style={styles.stage}>
        <PostingCeremony
          width={width}
          height={height}
          look={look}
          skin={skin}
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
          <Button label="Опустить" quiet={!needsButtons} onPress={() => setCommitKey((k) => k + 1)} />
        )}
        {state === 'posted' && (
          <>
            <Button label="Забрать письмо" onPress={() => setRetrieveKey((k) => k + 1)} />
            <Pressable onPress={() => setState('collected')}>
              <Text style={styles.lab}>(лаб) выемка прошла</Text>
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
  actions: { alignItems: 'center', gap: 8, minHeight: 44 },
  button: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 3, backgroundColor: '#efe2cc' },
  buttonText: { color: '#2a211b', fontSize: 15 },
  quiet: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  lab: { color: '#8f806b', fontSize: 12, textDecorationLine: 'underline' },
});
