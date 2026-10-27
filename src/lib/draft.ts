import { useSyncExternalStore } from 'react';

import type { FoldKind } from '@/letter/fold';
import type { EnvelopeFormat, SealDie, SealPlacement } from '@/letter/seal';
import type { Stroke } from '@/letter/strokes';
import type { LetterLook } from '@/letter/LetterSheet';
import type { LinerKind, PaperKind, WaxKind, WaxType } from '@/theme/stationery';

/** The envelope as sealed at /seal: everything the recipient needs to see the same seal. */
export type DraftEnvelope = {
  paper: PaperKind;
  liner: LinerKind;
  wax: WaxKind;
  waxType: WaxType;
  die: SealDie;
  initials: string;
  /** The envelope's own seed (tip wobble, wax outline): kept from sealing to posting, never reseeded. */
  seed: number;
  format: EnvelopeFormat;
  seal: SealPlacement;
};

/**
 * letters.envelope as the client sends it (the server adds `postmark`). `waxType`, `die`
 * and `seal` are absent on letters posted before sealing was free (and from senders that
 * skipped /seal): those render as brittle wax, the monogram, defaultSeal.
 */
export type EnvelopeJson = {
  paper: PaperKind;
  liner: LinerKind;
  wax: WaxKind;
  waxType?: WaxType;
  die?: SealDie;
  initials: string;
  seed: number;
  format?: EnvelopeFormat;
  seal?: SealPlacement;
};

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
  /** How it was folded at /fold (tri-fold if never folded). */
  fold?: FoldKind;
  /** Sealed at /seal; cleared by any change to the letter or its fold (it must be sealed again). */
  envelope?: DraftEnvelope;
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
    fold: d.fold ?? 'tri',
  };
}

/** letters.envelope for a sealed draft. */
export function envelopeJson(e: DraftEnvelope): EnvelopeJson {
  return {
    paper: e.paper,
    liner: e.liner,
    wax: e.wax,
    waxType: e.waxType,
    die: e.die,
    initials: e.initials,
    seed: e.seed,
    format: e.format,
    seal: e.seal,
  };
}

// The die picked last, for the next letter in this session (in memory only, like the draft).
let lastDie: SealDie | null = null;

export const getLastDie = (): SealDie | null => lastDie;

export function setLastDie(die: SealDie) {
  lastDie = die;
}
