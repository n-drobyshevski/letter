import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Desk } from '@/components/Desk';

const LABS = [
  { href: '/lab/jitter', title: 'Почерк', note: 'Typed text → handwriting: per-word jitter, ink load, bleed (RU + FR)' },
  { href: '/lab/typing', title: 'Письмо', note: 'Write with the keyboard straight onto the paper, then see it "dry" into ink' },
  { href: '/lab/fold', title: 'Сложить', note: 'Swipe up to tri-fold the letter; panels, creases, shadows, haptics' },
  { href: '/lab/envelope', title: 'Конверт', note: 'Slide the letter in, close the flap, hold to pour wax, press the seal' },
] as const;

export default function Home() {
  return (
    <Desk title="Письма" hint="Week-1 spikes. Each lab answers one risk before the real screens are built.">
      {LABS.map((lab) => (
        <Link key={lab.href} href={lab.href} asChild>
          <Pressable style={styles.card}>
            <Text style={styles.cardTitle}>{lab.title}</Text>
            <Text style={styles.cardNote}>{lab.note}</Text>
          </Pressable>
        </Link>
      ))}
    </Desk>
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
  cardTitle: { fontFamily: 'BadScript_400Regular', fontSize: 24, color: '#1f2b4d' },
  cardNote: { fontSize: 13, color: '#5a4c3e', marginTop: 4 },
});
