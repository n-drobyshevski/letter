import { useSyncExternalStore } from 'react';

import type { Stroke } from '@/letter/strokes';
import type { LetterLook } from '@/letter/LetterSheet';

/**
 * The letter being written, handed from the desk to the postbox. In memory only for
 * now (the encrypted autosave from the plan comes later). The posting screen sends
 * exactly this, never sample copy: a real letter reaches a real person.
 */
export type Draft = {
  text: string;
  /** Pen strokes in sheet pixels, at sheetWidth. */
  strokes: Stroke[];
  sheetWidth: number;
  look: LetterLook;
};

let draft: Draft | null = null;
const listeners = new Set<() => void>();

export function setDraft(next: Draft | null) {
  draft = next;
  listeners.forEach((l) => l());
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

export const isEmptyDraft = (d: Draft | null) => !d || (d.text.trim() === '' && d.strokes.length === 0);

/** letter_contents.body, schema_v 1: { text, strokes, font, ink, paper } (+ the width the strokes were drawn at). */
export function draftBody(d: Draft) {
  return {
    text: d.text,
    strokes: d.strokes,
    sheet_width: d.sheetWidth,
    font: d.look.font,
    ink: d.look.ink,
    paper: d.look.paper,
  };
}
