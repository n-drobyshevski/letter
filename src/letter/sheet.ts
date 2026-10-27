import { useWindowDimensions } from 'react-native';

import { PAPERS, type PaperKind, type PaperSpec } from '../theme/stationery';

/** A-series proportions: the sheet is √2 tall. */
export const SHEET_RATIO = Math.SQRT2;

/** The sheet for this window: at most `maxWidth` wide, `gutter` narrower than the window, and (if given) at most `maxHeight` tall. */
export function useSheetSize(maxWidth = 520, gutter = 32, maxHeight?: number) {
  const { width } = useWindowDimensions();
  const w = Math.round(Math.min(width - gutter, maxWidth, maxHeight ? Math.floor(maxHeight / SHEET_RATIO) : Infinity));
  return { width: w, height: Math.round(w * SHEET_RATIO) };
}

/**
 * Paper spec scaled to the sheet: a notebook page is about 30 cells wide; a Seyès page 15 heavy
 * pitches (a real cahier has 17–19, but our sheets show the hand at about twice its size).
 */
export function paperFor(kind: PaperKind, sheetWidth: number): PaperSpec {
  const base = PAPERS[kind];
  return { ...base, cell: base.ruling === 'seyes' ? sheetWidth / 15 : base.cell ? sheetWidth / 30 : 0 };
}

/** The hand's size: the same on both rulings (w/20), so a Seyès line holds what a notebook line does. */
export function fontSizeFor(paper: PaperSpec, sheetWidth: number) {
  return paper.ruling === 'seyes' ? paper.cell * 0.75 : paper.cell ? paper.cell * 1.5 : sheetWidth / 21;
}
