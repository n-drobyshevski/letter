import { useWindowDimensions } from 'react-native';

import { PAPERS, type PaperKind, type PaperSpec } from '../theme/stationery';

/** A-series proportions: the sheet is √2 tall. */
export const SHEET_RATIO = Math.SQRT2;

export function useSheetSize(maxWidth = 520, gutter = 32) {
  const { width } = useWindowDimensions();
  const w = Math.round(Math.min(width - gutter, maxWidth));
  return { width: w, height: Math.round(w * SHEET_RATIO) };
}

/** Paper spec scaled to the sheet: a notebook page is about 30 cells wide. */
export function paperFor(kind: PaperKind, sheetWidth: number): PaperSpec {
  const base = PAPERS[kind];
  return { ...base, cell: base.cell ? sheetWidth / 30 : 0 };
}

export function fontSizeFor(paper: PaperSpec, sheetWidth: number) {
  return paper.cell ? paper.cell * 1.5 : sheetWidth / 21;
}
