import { Desk } from '@/components/Desk';
import { useLabParams } from '@/lib/params';
import { FoldableLetter } from '@/letter/FoldableLetter';
import { useLetterPicture, type LetterLook } from '@/letter/LetterSheet';
import { SAMPLE_LETTER } from '@/letter/samples';
import { useSheetSize } from '@/letter/sheet';
import type { PaperKind } from '@/theme/stationery';

/**
 * Spike: does a Skia 2.5D tri-fold (rigid hinged panels + lighting) read as paper?
 * If not, only this moment moves to expo-gl + R3F with a bending vertex shader.
 */
export default function FoldLab() {
  const q = useLabParams();
  const size = useSheetSize(440, 72);
  const look: LetterLook = { paper: (q.paper as PaperKind) ?? 'cotton', ink: 'blueBlack', font: 'badScript', seed: q.seed ?? 1407 };
  const { picture: front } = useLetterPicture(SAMPLE_LETTER, look, size.width, size.height, 1);
  const { picture: back } = useLetterPicture('', look, size.width, size.height, 1, 'paper');

  return (
    <Desk title="Сложить" hint="Swipe up to fold in three, down to unfold. Flick to let it snap." scroll={false}>
      {front && back && (
        <FoldableLetter front={front} back={back} width={size.width} height={size.height} seed={look.seed} fixedT={q.t} />
      )}
    </Desk>
  );
}
