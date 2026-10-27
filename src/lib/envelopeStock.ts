import { ENVELOPE_PAPERS, type EnvelopePaper, type LinerKind, type PaperKind } from '../theme/kinds';
import type { StationeryPickPatch } from './stationeryPick';

export const isEnvelopePaper = (paper: PaperKind): paper is EnvelopePaper =>
  (ENVELOPE_PAPERS as readonly PaperKind[]).includes(paper);

/**
 * What a change of look at /seal tells the pick: the envelope's paper and liner, so the next
 * envelope (and the auto-envelope at /post) starts from the stock chosen last. Wax, die and the
 * rest stay with the draft. Undefined when the change names neither (or a sheet paper).
 */
export function envelopePickPatch(patch: { paper?: PaperKind; liner?: LinerKind }): StationeryPickPatch | undefined {
  const paper = patch.paper !== undefined && isEnvelopePaper(patch.paper) ? patch.paper : undefined;
  const liner = patch.liner;
  if (paper === undefined && liner === undefined) return undefined;
  return { envelope: { ...(paper && { paper }), ...(liner && { liner }) } };
}
