import { useEffect, useState } from 'react';

import type { SealCommand, SealCommandKind, SealHint, Stage } from './EnvelopeCeremony';
import { dieLabel } from './DieTray';
import type { SealDie } from './sealDies';

/**
 * The words around the sealing ceremony, ru with its fr equivalent: the ceremony says
 * which hint (onHint), the screen shows it in the writer's language. Shared by /seal,
 * /lab/envelope and the journey. Same register as the rest of the app: ты / tu.
 */

type Lang = 'ru' | 'fr';

export type SealCopy = {
  title: string;
  hints: Record<SealHint, string> & { 'wax.more': string; 'ready.buttons': string };
  die: (name: string) => string;
  buttons: Record<SealCommandKind, string>;
  again: string;
  toPost: string;
  reseal: string;
  empty: string;
  toDesk: string;
};

export const SEAL_COPY: Record<Lang, SealCopy> = {
  ru: {
    title: 'Конверт',
    hints: {
      insert: 'Потяни письмо вниз, в конверт',
      close: 'Закрой клапан: потяни вниз или коснись',
      ready: 'Нажми и держи там, где будет печать',
      'ready.buttons': 'Коснись, где будет печать, и нажми «Налить сургуч»',
      pouring: 'Веди плавно — капля выйдет ровнее',
      wax: 'Выбери печать и коснись, где её приложить',
      'wax.more': 'Подержи на капле — добавится сургуч',
      carry: 'Отпусти — печать опустится',
      miss: 'Мимо сургуча',
      outside: 'Только на конверт',
      press: 'Печать…',
      sealed: 'Запечатано',
      decor: 'Печать для красоты — клапан держит клей',
    },
    die: (name) => `Печать: ${name}`,
    buttons: {
      insert: 'Вложить',
      close: 'Закрыть',
      pour: 'Налить сургуч',
      more: 'Ещё сургуча',
      rotateLeft: '↺',
      rotateRight: '↻',
      press: 'Приложить печать',
      reset: 'Заново',
    },
    again: 'Ещё раз',
    toPost: 'На почту →',
    reseal: 'Запечатать заново',
    empty: 'Сначала напиши письмо',
    toDesk: 'За стол →',
  },
  fr: {
    title: 'L’enveloppe',
    hints: {
      insert: 'Glisse la lettre vers le bas, dans l’enveloppe',
      close: 'Ferme le rabat : tire vers le bas ou touche-le',
      ready: 'Appuie et maintiens là où ira le cachet',
      'ready.buttons': 'Touche là où ira le cachet, puis « Verser la cire »',
      pouring: 'Guide doucement : la goutte sera plus ronde',
      wax: 'Choisis un cachet et touche où l’appliquer',
      'wax.more': 'Maintiens sur la goutte pour ajouter de la cire',
      carry: 'Relâche : le cachet descend',
      miss: 'À côté de la cire',
      outside: 'Seulement sur l’enveloppe',
      press: 'Le cachet…',
      sealed: 'Cacheté',
      decor: 'Cachet décoratif : la colle tient le rabat',
    },
    die: (name) => `Cachet : ${name}`,
    buttons: {
      insert: 'Glisser la lettre',
      close: 'Fermer',
      pour: 'Verser la cire',
      more: 'Encore de la cire',
      rotateLeft: '↺',
      rotateRight: '↻',
      press: 'Apposer le cachet',
      reset: 'Recommencer',
    },
    again: 'Encore une fois',
    toPost: 'À la poste →',
    reseal: 'Cacheter à nouveau',
    empty: 'Écris d’abord ta lettre',
    toDesk: 'À ton bureau →',
  },
};

/** The buttons that make sense now (every gesture has one). */
export function sealActions(stage: Stage, hint: SealHint): SealCommandKind[] {
  if (stage === 0) return ['insert'];
  if (stage === 1) return ['close'];
  if (stage !== 2) return [];
  if (hint === 'ready' || hint === 'outside') return ['pour'];
  if (hint === 'wax' || hint === 'miss') return ['more', 'rotateLeft', 'rotateRight', 'press', 'reset'];
  if (hint === 'carry') return ['rotateLeft', 'rotateRight'];
  return [];
}

/**
 * The screen's side of the ceremony: the hint to show (a die name on pick, a word about
 * pouring more after 3 s alone with the wax), the stage, and the button commands.
 * `needsButtons`: the buttons lead, so the hints name them instead of asking for holds;
 * `fixed`: a frozen QA frame, whose text must not change with time.
 */
export function useSealControls(lang: Lang, onReset?: () => void, opts: { needsButtons?: boolean; fixed?: boolean } = {}) {
  const { needsButtons = false, fixed = false } = opts;
  const copy = SEAL_COPY[lang];
  const [stage, setStage] = useState<Stage>(0);
  const [hint, setHint] = useState<SealHint>('insert');
  const [full, setFull] = useState(false);
  const [dieHint, setDieHint] = useState<SealDie | null>(null);
  const [idle, setIdle] = useState(false);
  const [command, setCommand] = useState<SealCommand>({ kind: 'reset', n: 0 });

  // «Hold on the drop to add wax» only when a hold would: not on a full puddle, not when
  // the buttons lead («Ещё сургуча» says it), not on a frozen frame.
  const offerMore = hint === 'wax' && !full && !needsButtons && !fixed;
  useEffect(() => {
    if (!offerMore) return;
    const timer = setTimeout(() => setIdle(true), 3000);
    return () => clearTimeout(timer);
  }, [offerMore]);

  const onHint = (h: SealHint, info?: { full: boolean }) => {
    setHint(h);
    setFull(info?.full ?? false);
    setDieHint(null);
    setIdle(false);
  };
  const run = (kind: SealCommandKind) => {
    setCommand((c) => ({ kind, n: c.n + 1 }));
    if (kind === 'reset') onReset?.();
  };
  const shown = dieHint
    ? copy.die(dieLabel(dieHint, lang))
    : offerMore && idle
      ? copy.hints['wax.more']
      : hint === 'ready' && needsButtons
        ? copy.hints['ready.buttons']
        : copy.hints[hint];

  return {
    copy,
    stage,
    hint,
    shown,
    actions: sealActions(stage, hint),
    command,
    run,
    /** Props for EnvelopeCeremony. */
    ceremony: { command, onStage: setStage, onHint, onDie: (die: SealDie) => setDieHint(die) },
  };
}
