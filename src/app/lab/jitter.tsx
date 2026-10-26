import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Choice } from '@/components/Choice';
import { Desk } from '@/components/Desk';
import { useLabParams } from '@/lib/params';
import { LetterSheet, type LetterLook } from '@/letter/LetterSheet';
import { SAMPLE_LETTER } from '@/letter/samples';
import { useSheetSize } from '@/letter/sheet';
import { HANDWRITING_FONTS, INKS, type FontKey, type InkKind, type PaperKind } from '@/theme/stationery';

const PAPER_OPTIONS = [
  { key: 'grid', label: 'В клетку' },
  { key: 'cotton', label: 'Хлопковая' },
] as const;
const INK_OPTIONS = (Object.keys(INKS) as InkKind[]).map((k) => ({ key: k, label: INKS[k].label }));
const FONT_OPTIONS = (Object.keys(HANDWRITING_FONTS) as FontKey[]).map((k) => ({ key: k, label: HANDWRITING_FONTS[k].label }));

export default function JitterLab() {
  const q = useLabParams();
  const size = useSheetSize();
  const [look, setLook] = useState<LetterLook>({
    paper: (q.paper as PaperKind) ?? 'grid',
    ink: (q.ink as InkKind) ?? 'blueBlack',
    font: (q.font as FontKey) ?? 'badScript',
    seed: q.seed ?? 20261026,
  });
  const set = (patch: Partial<LetterLook>) => setLook((l) => ({ ...l, ...patch }));

  return (
    <Desk title="Почерк" hint="Same text, same seed → identical sheet on both phones. New seed → a new day's hand.">
      <Choice options={PAPER_OPTIONS} value={look.paper} onChange={(paper) => set({ paper })} />
      <Choice options={FONT_OPTIONS} value={look.font} onChange={(font) => set({ font })} />
      <Choice options={INK_OPTIONS} value={look.ink} onChange={(ink) => set({ ink })} />
      <Pressable onPress={() => set({ seed: (look.seed * 1103515245 + 12345) >>> 0 })} style={styles.button}>
        <Text style={styles.buttonText}>Другой день, другой почерк · seed {look.seed}</Text>
      </Pressable>
      <LetterSheet text={SAMPLE_LETTER} look={look} width={size.width} height={size.height} />
    </Desk>
  );
}

const styles = StyleSheet.create({
  button: { paddingVertical: 6, paddingHorizontal: 12 },
  buttonText: { color: '#b9a88f', fontSize: 13, textDecorationLine: 'underline' },
});
