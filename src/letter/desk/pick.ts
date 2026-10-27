import { defaultTwoSided, emptyFace, isEmptySheet, type SheetContent } from '../stack';
import type { DeskItem, PickOutcome, PickState } from './types';

/**
 * What the letter holds once the demo line (/write's preview on sheet 1's recto, until that text is
 * edited) is left out: the draft the postbox sends. Everything else counts: pen strokes on the demo
 * recto, a written verso, a written later sheet.
 */
export function withoutDemo(sheets: SheetContent[], demo: boolean): SheetContent[] {
  return demo ? sheets.map((s, i) => (i === 0 ? { ...s, recto: { ...s.recto, text: '' } } : s)) : sheets;
}

/** The letter is blank (every pick applies, spec §4.1) when nothing but the demo line is on it. */
export const isBlankLetter = (sheets: SheetContent[], demo: boolean) => withoutDemo(sheets, demo).every(isEmptySheet);

/**
 * What taking an item does to the letter (spec §4.1, phase A): while the letter is blank every
 * pick applies; once written, paper, pen and ink are locked (the same paper adds the next sheet);
 * envelopes always apply, after a confirmation if the letter is sealed. Pure: the screen applies
 * the outcome and remembers it with `setStationeryPick`. Refusals change nothing.
 */
export function applyPick(s: PickState, item: DeskItem, confirmed = false): PickOutcome {
  switch (item.kind) {
    case 'paper': {
      const paper = item.paper;
      if (s.blank) {
        // Re-paper: every sheet keeps its recto (the demo line stays as a preview); its verso is emptied
        // (blank, so nothing written is lost).
        const twoSided = defaultTwoSided(paper);
        return {
          kind: 'apply',
          look: { ...s.look, paper },
          sheets: s.sheets.map((sheet) => ({ ...sheet, verso: emptyFace(), twoSided })),
        };
      }
      if (paper !== s.look.paper) return { kind: 'refuse', hint: 'paperLocked' };
      const last = s.sheets[s.sheets.length - 1];
      if (last && isEmptySheet(last)) return { kind: 'refuse', hint: 'blankWaiting' };
      if (s.sheets.length >= s.maxSheets) return { kind: 'refuse', hint: 'full' };
      return { kind: 'apply', addSheet: true, hint: 'nextSheet' };
    }
    case 'pen': {
      if (s.blank) return { kind: 'apply', look: { ...s.look, font: item.font } };
      // The same pen is in hand, not in the drawer: nothing to change.
      return item.font === s.look.font ? { kind: 'apply' } : { kind: 'refuse', hint: 'penLocked' };
    }
    case 'ink': {
      if (s.blank) return { kind: 'apply', look: { ...s.look, ink: item.ink } };
      return item.ink === s.look.ink ? { kind: 'apply' } : { kind: 'refuse', hint: 'inkLocked' };
    }
    case 'envelope': {
      const envelope = { paper: item.paper, liner: item.liner };
      const same = envelope.paper === s.envelope.paper && envelope.liner === s.envelope.liner;
      // The same envelope keeps its seal; another one means sealing again.
      if (same || !s.sealed) return { kind: 'apply', envelope };
      if (!confirmed) return { kind: 'confirm', hint: 'sealedConfirm' };
      return { kind: 'apply', envelope, unseal: true };
    }
  }
}
