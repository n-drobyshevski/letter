import { useState } from 'react';

import { Desk } from '@/components/Desk';
import { useLabParams } from '@/lib/params';
import { FOLD_KINDS, type FoldKind } from '@/letter/fold';
import { FoldableLetter } from '@/letter/FoldableLetter';
import { useStackPictures, type LetterLook } from '@/letter/LetterSheet';
import { sampleSheets } from '@/letter/samples';
import { useSheetSize } from '@/letter/sheet';
import { maxSheetsFor } from '@/letter/stack';
import type { PaperKind } from '@/theme/stationery';

const HINT: Record<FoldKind | 'none', string> = {
  none: 'Swipe up: fold in three · pull the top edge down: fold in half',
  tri: 'In three, for a DL envelope. Swipe down to unfold',
  half: 'In half (A5). Swipe left to fold it again, up to unfold',
  quarter: 'In four (A6). Swipe right to open it back to a half',
};

/**
 * Spike: does a Skia 2.5D fold (rigid hinged panels + lighting) read as paper?
 * The gesture chooses the fold; `?fold=tri|half|quarter&t=` freezes a frame for QA,
 * `?sheets=2..4` folds a stack (the last sheet's back on the outside).
 */
export default function FoldLab() {
  const q = useLabParams();
  const size = useSheetSize(440, 72);
  const fixedKind = FOLD_KINDS.includes(q.fold as FoldKind) ? (q.fold as FoldKind) : undefined;
  const frozen = q.t !== undefined;
  const [chosen, setChosen] = useState<FoldKind | null>(null);
  const kind = fixedKind ?? chosen;
  const look: LetterLook = { paper: (q.paper as PaperKind) ?? 'cotton', ink: 'blueBlack', font: 'badScript', seed: q.seed ?? 1407 };
  // Creases appear once a fold is made (QA frames always show them).
  const crease = frozen || kind ? 1 : 0;
  const [sheets] = useState(() => sampleSheets(q.sheets ?? 1));
  const stack = useStackPictures(sheets, look, size.width, size.height, crease, kind ?? 'tri', size.width);
  const { front, back } = stack;

  return (
    <Desk title="Сложить" hint={HINT[kind ?? 'none']} scroll={false}>
      {front && back && (
        <FoldableLetter
          front={front}
          back={back}
          sheets={stack.sheets}
          edgeColor={stack.edgeColor}
          allowQuarter={sheets.length <= maxSheetsFor('quarter')}
          width={size.width}
          height={size.height}
          seed={look.seed}
          kind={frozen ? (fixedKind ?? 'tri') : fixedKind}
          fixedT={q.t}
          onKind={setChosen}
        />
      )}
    </Desk>
  );
}
