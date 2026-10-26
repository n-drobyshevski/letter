import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Desk } from '@/components/Desk';
import { isEmptyDraft, setDraft, useDraft } from '@/lib/draft';
import { useCouple, useSession } from '@/lib/mail';
import { useMotionPrefs } from '@/lib/useMotionPrefs';
import type { FoldKind } from '@/letter/fold';
import { FoldableLetter } from '@/letter/FoldableLetter';
import { useLetterPicture, useWithStrokes } from '@/letter/LetterSheet';
import { useSheetSize } from '@/letter/sheet';
import type { Lang } from '@/letter/tracking/copy';

/** UI copy follows the writer, informal ты/tu. */
const COPY = {
  ru: {
    title: 'Сложить',
    hint: {
      none: 'Потяни снизу вверх — сложить втрое · потяни верхний край вниз — пополам',
      tri: 'Втрое, как обычное письмо. Вниз — развернуть',
      half: 'Пополам. Проведи влево — сложить ещё раз, вверх — развернуть',
      quarter: 'Вчетверо, маленьким квадратиком. Вправо — развернуть',
    },
    empty: 'Сначала напиши письмо',
    toDesk: 'За стол →',
    toPost: 'В конверт и на почту →',
    buttons: { tri: 'Втрое', half: 'Пополам', quarter: 'Вчетверо' },
  },
  fr: {
    title: 'Plier',
    hint: {
      none: 'Glisse vers le haut : en trois · tire le bord du haut vers le bas : en deux',
      tri: 'En trois, comme une lettre. Vers le bas pour la déplier',
      half: 'En deux. Vers la gauche pour la plier encore, vers le haut pour la déplier',
      quarter: 'En quatre, toute petite. Vers la droite pour la rouvrir',
    },
    empty: 'Écris d’abord ta lettre',
    toDesk: 'À ton bureau →',
    toPost: 'Dans l’enveloppe, à la poste →',
    buttons: { tri: 'En trois', half: 'En deux', quarter: 'En quatre' },
  },
};

/**
 * Between the desk and the postbox: fold the letter you wrote. The gesture picks
 * the fold (see FoldableLetter); it is saved with the letter so it is unfolded
 * the same way at the other end.
 */
export default function FoldScreen() {
  const session = useSession();
  const { couple } = useCouple(session?.user.id);
  const lang: Lang = couple?.me.locale ?? 'ru';
  const copy = COPY[lang];
  const draft = useDraft();
  const size = useSheetSize(440, 72);
  const { needsButtons } = useMotionPrefs();

  const [kind, setKind] = useState<FoldKind | null>(null);
  const [folded, setFolded] = useState<FoldKind | null>(null);

  const look = draft?.look ?? { paper: 'cotton' as const, ink: 'blueBlack' as const, font: 'badScript' as const, seed: 7 };
  // Creases appear once a fold has begun.
  const { picture: inked } = useLetterPicture(draft?.text ?? '', look, size.width, size.height, kind ? 1 : 0, 'all', kind ?? 'tri');
  const front = useWithStrokes(inked, draft?.strokes, draft?.sheetWidth, look, size.width, size.height);
  const { picture: back } = useLetterPicture('', look, size.width, size.height, kind ? 1 : 0, 'paper', kind ?? 'tri');

  if (isEmptyDraft(draft)) {
    return (
      <Desk title={copy.title} hint={copy.empty}>
        <Link href="/write" style={styles.link}>
          {copy.toDesk}
        </Link>
      </Desk>
    );
  }

  const keep = (k: FoldKind) => setDraft({ ...draft!, fold: k });

  return (
    <Desk title={copy.title} hint={copy.hint[folded ?? kind ?? 'none']} scroll={false}>
      {front && back && (
        <FoldableLetter
          front={front}
          back={back}
          width={size.width}
          height={size.height}
          seed={look.seed}
          onKind={setKind}
          onSettled={(t, k) => {
            if (t === 1) keep(k);
            setFolded(t === 1 ? k : null);
          }}
        />
      )}
      <View style={styles.actions}>
        {folded && (
          <Link href="/post" style={styles.button}>
            {copy.toPost}
          </Link>
        )}
        {/* Every gesture has a tap alternative; it leads when Reduce Motion or a screen reader is on. */}
        {!folded && needsButtons && (
          <View style={styles.row}>
            {(['tri', 'half', 'quarter'] as const).map((k) => (
              <Link key={k} href="/post" asChild>
                <Pressable onPress={() => keep(k)} style={styles.tag} accessibilityRole="button">
                  <Text style={styles.tagText}>{copy.buttons[k]}</Text>
                </Pressable>
              </Link>
            ))}
          </View>
        )}
      </View>
    </Desk>
  );
}

const styles = StyleSheet.create({
  actions: { alignItems: 'center', gap: 8, minHeight: 44 },
  row: { flexDirection: 'row', gap: 8 },
  button: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 3,
    backgroundColor: '#efe2cc',
    color: '#2a211b',
    fontSize: 15,
    overflow: 'hidden',
  },
  tag: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 3, backgroundColor: '#4a3a2e' },
  tagText: { color: '#e4d6bf', fontSize: 14 },
  link: { color: '#e4d6bf', fontSize: 14, textDecorationLine: 'underline' },
});
