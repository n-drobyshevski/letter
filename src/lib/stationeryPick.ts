import { useSyncExternalStore } from 'react';

import type { EnvelopePaper, FontKey, InkKind, LinerKind, SheetPaper } from '../theme/kinds';

/**
 * What was last taken from the desk's drawers, for this letter and the next one. It survives a
 * blank desk (the draft is null until the first word) and every edit, so a pick made before
 * writing is not lost; `/seal` and the auto-envelope at `/post` start from its envelope.
 * In memory only for now, like the draft and the last die.
 */
export type StationeryPick = {
  paper: SheetPaper;
  ink: InkKind;
  font: FontKey;
  envelope: { paper: EnvelopePaper; liner: LinerKind };
};

/** A change to the pick: any of its fields, the envelope's paper and liner each on their own. */
export type StationeryPickPatch = Partial<Omit<StationeryPick, 'envelope'>> & {
  envelope?: Partial<StationeryPick['envelope']>;
};

/** Today's /write look: notebook paper, blue-black ink, Bad Script, a cream envelope with the postal liner. */
export const DEFAULT_STATIONERY_PICK: StationeryPick = {
  paper: 'grid',
  ink: 'blueBlack',
  font: 'badScript',
  envelope: { paper: 'cream', liner: 'postal' },
};

let pick: StationeryPick = DEFAULT_STATIONERY_PICK;
const listeners = new Set<() => void>();

export const getStationeryPick = (): StationeryPick => pick;

/** Merges `patch` into the pick. Listeners hear only real changes (the object stays the same otherwise). */
export function setStationeryPick(patch: StationeryPickPatch) {
  const envelope = { paper: patch.envelope?.paper ?? pick.envelope.paper, liner: patch.envelope?.liner ?? pick.envelope.liner };
  const next: StationeryPick = {
    paper: patch.paper ?? pick.paper,
    ink: patch.ink ?? pick.ink,
    font: patch.font ?? pick.font,
    envelope: envelope.paper === pick.envelope.paper && envelope.liner === pick.envelope.liner ? pick.envelope : envelope,
  };
  if (next.paper === pick.paper && next.ink === pick.ink && next.font === pick.font && next.envelope === pick.envelope) return;
  pick = next;
  listeners.forEach((l) => l());
}

/** Back to the defaults (tests; a new session starts there anyway). */
export function resetStationeryPick() {
  if (pick === DEFAULT_STATIONERY_PICK) return;
  pick = DEFAULT_STATIONERY_PICK;
  listeners.forEach((l) => l());
}

export function subscribeStationeryPick(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useStationeryPick(): StationeryPick {
  return useSyncExternalStore(subscribeStationeryPick, getStationeryPick, getStationeryPick);
}
