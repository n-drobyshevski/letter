import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Desk } from '@/components/Desk';
import { useLabParams } from '@/lib/params';
import { useMotionPrefs } from '@/lib/useMotionPrefs';
import type { EnvelopeLook } from '@/letter/EnvelopeCeremony';
import { FoldableLetter } from '@/letter/FoldableLetter';
import { LetterSheet, useLetterPicture, type LetterLook } from '@/letter/LetterSheet';
import { ReceivingCeremony, type ReceiveStage } from '@/letter/ReceivingCeremony';
import { SAMPLE_LETTER } from '@/letter/samples';
import { SHEET_RATIO } from '@/letter/sheet';

type Phase = 'mailbox' | 'unfold' | 'read';

const HINTS: Record<ReceiveStage, string> = {
  0: 'В ящике что-то белеет. Открой ящик',
  1: 'Достань письмо',
  2: 'Переверни конверт',
  3: 'Проведи ножом вдоль сгиба',
  4: 'Достань письмо из конверта',
  5: 'Разверни',
};

const ADDRESS = { fromName: 'Н.', fromCity: 'Москва', toName: 'М.', toCity: 'Париж, Франция' };

export default function MailboxLab() {
  const q = useLabParams();
  const { width: sw, height: sh } = useWindowDimensions();
  const width = Math.min(sw, 480);
  const height = Math.round(Math.min(sh - 190, 640));
  const ew = Math.round(Math.min(width - 40, 360));
  const sheet = { width: Math.round(ew * 0.93), height: Math.round(ew * 0.93 * SHEET_RATIO) };
  const seed = q.seed ?? 1407;

  const fixedReceive = q.t !== undefined && q.t <= 0.7 ? q.t : undefined;
  const fixedUnfold = q.t !== undefined && q.t > 0.7 ? 1 - (q.t - 0.7) / 0.3 : undefined;
  const [phase, setPhase] = useState<Phase>(fixedUnfold !== undefined ? 'unfold' : 'mailbox');
  const [stage, setStage] = useState<ReceiveStage>(0);
  const [advanceKey, setAdvanceKey] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const { needsButtons } = useMotionPrefs();

  const letterLook: LetterLook = { paper: 'cotton', ink: 'blueBlack', font: 'badScript', seed };
  const look: EnvelopeLook = { paper: 'cream', liner: 'postal', wax: 'bordeaux', initials: 'Н', seed };
  const { picture: front } = useLetterPicture(SAMPLE_LETTER, letterLook, sheet.width, sheet.height, 1);
  const { picture: back } = useLetterPicture('', letterLook, sheet.width, sheet.height, 1, 'paper');
  const [postmark] = useState(() => ({ city: 'Москва', date: q.t !== undefined ? '2026-10-24' : new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10) }));

  const onStage = (s: ReceiveStage) => {
    setStage(s);
    if (s === 5) setTimeout(() => setPhase('unfold'), 350);
  };

  const hint = phase === 'mailbox' ? HINTS[stage] : phase === 'unfold' ? 'Разверни: потяни вниз' : 'От Н., из Москвы';

  return (
    <Desk title="Почтовый ящик · кв. 47" hint={hint} scroll={phase === 'read'}>
      {phase === 'mailbox' && front && back && (
        <View style={styles.stage}>
          <ReceivingCeremony
            key={replayKey}
            width={width}
            height={height}
            look={look}
            address={ADDRESS}
            postmark={postmark}
            letterFront={front}
            letterBack={back}
            sheet={sheet}
            flat={47}
            fixedT={fixedReceive}
            onStage={onStage}
            advanceKey={advanceKey}
          />
        </View>
      )}
      {phase === 'unfold' && front && back && (
        <FoldableLetter
          front={front}
          back={back}
          width={sheet.width}
          height={sheet.height}
          seed={seed}
          initialT={1}
          fixedT={fixedUnfold}
          onSettled={(t) => {
            if (t === 0) {
              // The real app calls open_letter(id, 'slit') here; re-reads then skip straight to 'read'.
              setPhase('read');
            }
          }}
        />
      )}
      {phase === 'read' && (
        <LetterSheet text={SAMPLE_LETTER} look={letterLook} width={sheet.width} height={sheet.height} crease={0.35} />
      )}
      <View style={styles.actions}>
        {phase === 'mailbox' && stage < 5 && (
          <Button label="Дальше" quiet={!needsButtons} onPress={() => setAdvanceKey((k) => k + 1)} />
        )}
        {phase === 'read' && (
          <Button
            label="Открыть заново"
            quiet
            onPress={() => {
              setStage(0);
              setReplayKey((k) => k + 1);
              setPhase('mailbox');
            }}
          />
        )}
      </View>
    </Desk>
  );
}

function Button({ label, onPress, quiet = false }: { label: string; onPress: () => void; quiet?: boolean }) {
  return (
    <Pressable onPress={onPress} style={quiet ? styles.quiet : styles.button} accessibilityRole="button">
      <Text style={quiet ? styles.link : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stage: { marginHorizontal: -16 },
  actions: { alignItems: 'center', gap: 8, minHeight: 44 },
  button: { minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 3, backgroundColor: '#efe2cc' },
  buttonText: { color: '#2a211b', fontSize: 15 },
  quiet: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  link: { color: '#8f806b', fontSize: 12, textDecorationLine: 'underline' },
});
