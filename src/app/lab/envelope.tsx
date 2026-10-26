import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { Choice } from '@/components/Choice';
import { Desk } from '@/components/Desk';
import { useLabParams } from '@/lib/params';
import { EnvelopeCeremony, type EnvelopeLook, type Stage } from '@/letter/EnvelopeCeremony';
import { useLetterPicture, type LetterLook } from '@/letter/LetterSheet';
import { SAMPLE_LETTER } from '@/letter/samples';
import { SHEET_RATIO } from '@/letter/sheet';
import { LINERS, WAX, WAX_TYPES, type LinerKind, type PaperKind, type WaxKind, type WaxType } from '@/theme/stationery';

const HINTS: Record<Stage, string> = {
  0: 'Потяните письмо вниз, в конверт',
  1: 'Закройте клапан: потяните вниз или коснитесь',
  2: 'Удерживайте, чтобы налить сургуч',
  3: 'Печать…',
  4: 'Запечатано',
};

const PAPER_OPTIONS = [
  { key: 'cream', label: 'Кремовый' },
  { key: 'kraft', label: 'Крафт' },
] as const;
const LINER_OPTIONS = (Object.keys(LINERS) as LinerKind[]).map((k) => ({ key: k, label: LINERS[k].label }));
const WAX_OPTIONS = (Object.keys(WAX) as WaxKind[]).map((k) => ({ key: k, label: WAX[k].label }));
const WAX_TYPE_OPTIONS = (Object.keys(WAX_TYPES) as WaxType[]).map((k) => ({ key: k, label: WAX_TYPES[k].label }));

export default function EnvelopeLab() {
  const q = useLabParams();
  const { width: screenW } = useWindowDimensions();
  const envW = Math.round(Math.min(screenW - 48, 480));
  const sheet = { width: Math.round(envW * 0.93), height: Math.round(envW * 0.93 * SHEET_RATIO) };

  const seed = q.seed ?? 1407;
  const letterLook: LetterLook = { paper: 'cotton', ink: 'blueBlack', font: 'badScript', seed };
  const { picture: front } = useLetterPicture(SAMPLE_LETTER, letterLook, sheet.width, sheet.height, 1);
  const { picture: back } = useLetterPicture('', letterLook, sheet.width, sheet.height, 1, 'paper');

  const [look, setLook] = useState<EnvelopeLook>({
    paper: (q.paper as PaperKind) ?? 'cream',
    liner: 'postal',
    wax: 'bordeaux',
    waxType: 'brittle',
    initials: 'Н',
    seed,
  });
  const set = (patch: Partial<EnvelopeLook>) => setLook((l) => ({ ...l, ...patch }));
  const [stage, setStage] = useState<Stage>(0);
  const [resetKey, setResetKey] = useState(0);

  return (
    <Desk title="Конверт" hint={HINTS[stage]}>
      <Choice options={PAPER_OPTIONS} value={look.paper} onChange={(paper) => set({ paper })} />
      <Choice options={LINER_OPTIONS} value={look.liner} onChange={(liner) => set({ liner })} />
      <Choice options={WAX_OPTIONS} value={look.wax} onChange={(wax) => set({ wax })} />
      <Choice options={WAX_TYPE_OPTIONS} value={look.waxType ?? 'brittle'} onChange={(waxType) => set({ waxType })} />
      {front && back && (
        <EnvelopeCeremony
          letterFront={front}
          letterBack={back}
          sheet={sheet}
          width={envW}
          look={look}
          onStage={setStage}
          fixedT={q.t}
          resetKey={resetKey}
        />
      )}
      {stage === 4 && (
        <Pressable onPress={() => setResetKey((k) => k + 1)}>
          <Text style={styles.link}>Ещё раз</Text>
        </Pressable>
      )}
    </Desk>
  );
}

const styles = StyleSheet.create({
  link: { color: '#b9a88f', fontSize: 13, textDecorationLine: 'underline' },
});
