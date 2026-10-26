import { creaseOffsets } from './renderLetter';

/**
 * How a letter is folded, chosen by the sender's gesture at the desk:
 *   tri      letter fold in thirds (A4 → DL), bottom third up, top third down
 *   half     top edge brought down to the bottom (A4 → A5, a C5 envelope)
 *   quarter  then folded in half again crosswise (French fold, A4 → A6, C6)
 * Stored with the letter (body.fold) so the recipient unfolds it the same way.
 */
export type FoldKind = 'tri' | 'half' | 'quarter';
export const FOLD_KINDS: FoldKind[] = ['tri', 'half', 'quarter'];

/** Fold lines in sheet pixels: horizontal creases (y), plus a vertical one (x) for the quarter fold. Seeded, never exact. */
export function foldLines(kind: FoldKind, width: number, height: number, seed: number): { ys: number[]; x?: number } {
  const [o1, o2] = creaseOffsets(seed);
  if (kind === 'tri') return { ys: [height / 3 + o1, (height * 2) / 3 + o2] };
  const ys = [height / 2 + o1];
  return kind === 'quarter' ? { ys, x: width / 2 + o2 } : { ys };
}
