import { useSyncExternalStore } from 'react';

import type { FoldKind } from '../letter/fold';
import type { LetterLook } from '../letter/LetterSheet';
import { isEmptyFace, isEmptySheet, quantizeStroke, trimSheets, type FaceContent, type SheetContent } from '../letter/stack';

/**
 * The letter being written, handed from the desk to the postbox. In memory only for
 * now (the encrypted autosave from the plan comes later). The posting screen sends
 * exactly this, never sample copy: a real letter reaches a real person.
 */
export type Draft = {
  /** The sheets in reading order, each face with its own text and pen strokes (in sheet pixels, at sheetWidth). */
  sheets: SheetContent[];
  sheetWidth: number;
  /** look.seed is the letter's seed: the recipient lays the words out with it too. */
  look: LetterLook;
  /** How it was folded at /fold (tri-fold if never folded). */
  fold?: FoldKind;
};

let draft: Draft | null = null;
const listeners = new Set<() => void>();

export function setDraft(next: Draft | null) {
  draft = next;
  listeners.forEach((l) => l());
}

export function getDraft() {
  return draft;
}

export function useDraft(): Draft | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => draft,
    () => draft,
  );
}

export const isEmptyDraft = (d: Draft | null) => !d || d.sheets.every(isEmptySheet);

/** The first words of the letter, for the desk's "on your desk" line. */
export const draftFirstText = (d: Draft | null) => d?.sheets.flatMap((s) => [s.recto.text, s.verso.text]).find((t) => t.trim()) ?? '';

/** Written sheets (trailing blank ones are left on the desk). */
export const writtenSheets = (d: Pick<Draft, 'sheets'>): SheetContent[] => trimSheets(d.sheets);

const wire = (f: FaceContent) => ({ text: f.text, strokes: f.strokes.map(quantizeStroke) });

/**
 * letter_contents.body. Sheet 1's recto stays at the top level, exactly as in
 * schema_v 1 ({ text, strokes, font, ink, paper } + the width the strokes were drawn at),
 * so an older reader still shows the first page. A longer letter adds schema_v 2:
 * `sheets[i]` holds the rest (sheets[0] only its verso), blank versos left out.
 */
export function draftBody(d: Draft) {
  const sheets = writtenSheets(d);
  const first = sheets[0];
  const body: Record<string, unknown> = {
    ...wire(first.recto),
    sheet_width: d.sheetWidth,
    font: d.look.font,
    ink: d.look.ink,
    paper: d.look.paper,
    fold: d.fold ?? 'tri',
    seed: d.look.seed,
  };
  const more = sheets.length > 1 || (first.twoSided && !isEmptyFace(first.verso));
  if (!more) return body;
  body.schema_v = 2;
  body.sheets = sheets.map((s, i) => {
    const entry: Record<string, unknown> = i === 0 ? {} : { recto: wire(s.recto) };
    if (s.twoSided && !isEmptyFace(s.verso)) entry.verso = wire(s.verso);
    return entry;
  });
  return body;
}

/** Bytes of the body as the server counts them (UTF-8), for the "too heavy" check before posting. */
export const bodyBytes = (body: unknown) => new TextEncoder().encode(JSON.stringify(body)).length;
/** Under the server's 2 MB, with room for jsonb's own spacing. */
export const MAX_BODY_BYTES = 1_500_000;
