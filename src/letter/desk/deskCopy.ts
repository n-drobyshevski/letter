import type { Lang } from '../tracking/copy';
import type { DeskItemId, DrawerKey, HintKey } from './types';

/**
 * The words around the writing desk, ru with its fr equivalent (spec §3.1, §4.2). Same register as
 * the rest of the app: ты / tu. Item captions double as the items' accessibility labels.
 */

export type DeskCopy = {
  /** The screen's hint under the title (two lines at most). */
  hint: string;
  /** The hint line above the band. */
  hints: Record<HintKey, string>;
  /** Labels on the drawer fronts' card holders. */
  fronts: Record<DrawerKey, string>;
  /** Item captions beside the open drawer, by item id. */
  items: Record<DeskItemId, string>;
  /** The sealed-letter confirmation's buttons. */
  take: string;
  keep: string;
  /** The quiet link under an open drawer (needsButtons). */
  close: string;
  /** Added to an item's label when it is in use. */
  inUse: string;
  /** A drawer front's accessibility label: «Ящик с бумагой, закрыт». */
  a11yDrawer: (drawer: DrawerKey, open: boolean) => string;
  /** What the live region says when a drawer opens. */
  opened: (drawer: DrawerKey) => string;
  /** An item's accessibility label, with the in-use note. */
  a11yItem: (id: DeskItemId, inUse: boolean) => string;
};

const RU_HINTS: Record<HintKey, string> = {
  firstPull: 'Потяни ящик вверх за ручку — или коснись его',
  'opened.paper': 'Возьми бумагу: коснись пачки или перенеси на стол',
  'opened.pens': 'Перо — это почерк, флакон — чернила',
  'opened.envelopes': 'Выбери конверт — он подождёт до печати',
  nextSheet: 'Новый лист ляжет следующим',
  blankWaiting: 'Чистый лист уже лежит на столе',
  full: 'Больше листов в конверт не влезет',
  paperLocked: 'Письмо начато на другой бумаге — эта для следующего',
  penLocked: 'Письмо пишется другим пером — это для следующего',
  inkLocked: 'Письмо пишется другими чернилами — эти для следующего',
  sealedConfirm: 'Письмо уже запечатано. Взять другой конверт? Печать придётся поставить заново.',
};

const FR_HINTS: Record<HintKey, string> = {
  firstPull: 'Tire un tiroir vers le haut par sa poignée, ou touche-le',
  'opened.paper': 'Prends du papier : touche une pile ou pose-la sur le bureau',
  'opened.pens': 'La plume, c’est l’écriture ; le flacon, l’encre',
  'opened.envelopes': 'Choisis une enveloppe : elle attendra le cachet',
  nextSheet: 'La nouvelle feuille vient à la suite',
  blankWaiting: 'Une feuille blanche t’attend déjà',
  full: 'L’enveloppe n’en prendra pas plus',
  paperLocked: 'Cette lettre est commencée sur un autre papier : garde celui-ci pour la prochaine',
  penLocked: 'Cette lettre s’écrit avec une autre plume : garde celle-ci pour la prochaine',
  inkLocked: 'Cette lettre s’écrit avec une autre encre : garde celle-ci pour la prochaine',
  sealedConfirm: 'La lettre est déjà cachetée. Prendre une autre enveloppe ? Il faudra la recacheter.',
};

const RU_ITEMS: Record<DeskItemId, string> = {
  'paper.grid': 'Тетрадные листы',
  'paper.seyes': 'Двойные листы Сейес',
  'paper.cotton': 'Хлопковая бумага',
  'paper.airmail': 'Тонкая авиабумага',
  'pen.fine': 'Перьевая ручка, тонкое перо',
  'pen.broad': 'Старая ручка, широкое перо',
  'pen.glass': 'Стеклянное перо',
  'ink.blueBlack': 'Сине-чёрные',
  'ink.ironGall': 'Железо-галловые',
  'ink.violet': 'Фиолетовые',
  'ink.sapphire': 'Синие, сапфир',
  'envelope.cream.postal': 'Кремовый · почтовая подкладка',
  'envelope.cream.bordeaux': 'Кремовый · бордо',
  'envelope.cream.forest': 'Кремовый · лес',
  'envelope.kraft.postal': 'Крафт · почтовая подкладка',
  'envelope.kraft.bordeaux': 'Крафт · бордо',
  'envelope.kraft.forest': 'Крафт · лес',
};

const FR_ITEMS: Record<DeskItemId, string> = {
  'paper.grid': 'Feuilles quadrillées',
  'paper.seyes': 'Copies doubles Seyès',
  'paper.cotton': 'Papier coton',
  'paper.airmail': 'Papier pelure (par avion)',
  'pen.fine': 'Stylo plume, pointe fine',
  'pen.broad': 'Stylo plume ancien, pointe large',
  'pen.glass': 'Plume de verre',
  'ink.blueBlack': 'Bleu-noir',
  'ink.ironGall': 'Ferro-gallique',
  'ink.violet': 'Violette',
  'ink.sapphire': 'Bleu saphir',
  'envelope.cream.postal': 'Crème · doublure postale',
  'envelope.cream.bordeaux': 'Crème · bordeaux',
  'envelope.cream.forest': 'Crème · forêt',
  'envelope.kraft.postal': 'Kraft · doublure postale',
  'envelope.kraft.bordeaux': 'Kraft · bordeaux',
  'envelope.kraft.forest': 'Kraft · forêt',
};

const RU_DRAWER_OF: Record<DrawerKey, string> = { paper: 'с бумагой', pens: 'с перьями', envelopes: 'с конвертами' };
const FR_DRAWER_OF: Record<DrawerKey, string> = { paper: 'à papier', pens: 'à plumes', envelopes: 'à enveloppes' };

export const DESK_COPY: Record<Lang, DeskCopy> = {
  ru: {
    hint: 'Пиши на листе. Бумага, перья и конверты — в ящиках стола.',
    hints: RU_HINTS,
    fronts: { paper: 'Бумага', pens: 'Перья', envelopes: 'Конверты' },
    items: RU_ITEMS,
    take: 'Взять',
    keep: 'Оставить',
    close: 'Задвинуть ящик',
    inUse: 'сейчас на столе',
    a11yDrawer: (drawer, open) => `Ящик ${RU_DRAWER_OF[drawer]}, ${open ? 'открыт' : 'закрыт'}`,
    opened: (drawer) => RU_HINTS[`opened.${drawer}`],
    a11yItem: (id, inUse) => (inUse ? `${RU_ITEMS[id]}, сейчас на столе` : RU_ITEMS[id]),
  },
  fr: {
    hint: 'Écris sur la feuille. Papier, plumes et enveloppes sont dans les tiroirs.',
    hints: FR_HINTS,
    fronts: { paper: 'Papier', pens: 'Plumes', envelopes: 'Enveloppes' },
    items: FR_ITEMS,
    take: 'Prendre',
    keep: 'Garder',
    close: 'Refermer le tiroir',
    inUse: 'sur le bureau',
    a11yDrawer: (drawer, open) => `Tiroir ${FR_DRAWER_OF[drawer]}, ${open ? 'ouvert' : 'fermé'}`,
    opened: (drawer) => FR_HINTS[`opened.${drawer}`],
    a11yItem: (id, inUse) => (inUse ? `${FR_ITEMS[id]}, sur le bureau` : FR_ITEMS[id]),
  },
};
