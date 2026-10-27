import type { ReactNode } from 'react';
import type { SharedValue } from 'react-native-reanimated';

import { hashString, subSeed } from '../../lib/random';
import {
  NEW_STATIONERY,
  type EnvelopePaper,
  type FontKey,
  type InkKind,
  type LinerKind,
  type PaperKind,
  type SheetPaper,
} from '../../theme/kinds';
import type { Country } from '../../theme/stationery';
import type { Lang } from '../tracking/copy';
import type { LetterLook } from '../LetterSheet';
import type { SheetContent } from '../stack';

/**
 * The writing desk's contract (spec §3, §4, §7): the drawers, what lies in them, the layout
 * and pick types, and the props of every desk component. Pure: no Skia, no React Native.
 */

// ---------------------------------------------------------------- drawers and items

/** The three drawers in the apron, left to right: paper, pens and inks (the shallow centre one), envelopes. */
export const DRAWERS = ['paper', 'pens', 'envelopes'] as const;
export type DrawerKey = (typeof DRAWERS)[number];

/** The pens: a pen sets the hand (font), a bottle sets the ink. */
export const PEN_KEYS = ['fine', 'broad', 'glass'] as const;
export type PenKey = (typeof PEN_KEYS)[number];

/** Modern fountain pen (fine nib), old celluloid pen (broad gold nib), twisted glass dip pen. Lengths are real (mm). */
export const PENS: Record<PenKey, { font: FontKey; lengthMm: number }> = {
  fine: { font: 'badScript', lengthMm: 129 },
  broad: { font: 'marckScript', lengthMm: 121 },
  glass: { font: 'caveat', lengthMm: 160 },
};

/** The pen that writes this hand (every font has exactly one). */
export function penFor(font: FontKey): PenKey {
  return PEN_KEYS.find((k) => PENS[k].font === font) ?? 'fine';
}

/** An envelope from the stock: its paper and its liner. */
export type EnvelopeStock = { paper: EnvelopePaper; liner: LinerKind };

/** The six envelopes in the drawer, front to back. */
export const ENVELOPE_STOCK: readonly EnvelopeStock[] = [
  { paper: 'cream', liner: 'postal' },
  { paper: 'cream', liner: 'bordeaux' },
  { paper: 'cream', liner: 'forest' },
  { paper: 'kraft', liner: 'postal' },
  { paper: 'kraft', liner: 'bordeaux' },
  { paper: 'kraft', liner: 'forest' },
];

/** Anything that can be taken from a drawer. `id` is used for a11y, `?item=`, captions and tests. */
export type DeskItem =
  | { id: `paper.${SheetPaper}`; drawer: 'paper'; kind: 'paper'; paper: SheetPaper }
  | { id: `pen.${PenKey}`; drawer: 'pens'; kind: 'pen'; pen: PenKey; font: FontKey }
  | { id: `ink.${InkKind}`; drawer: 'pens'; kind: 'ink'; ink: InkKind }
  | {
      id: `envelope.${EnvelopePaper}.${LinerKind}`;
      drawer: 'envelopes';
      kind: 'envelope';
      paper: EnvelopePaper;
      liner: LinerKind;
    };
export type DeskItemId = DeskItem['id'];
export type DeskItemKind = DeskItem['kind'];

const paperItem = (paper: SheetPaper): DeskItem => ({ id: `paper.${paper}`, drawer: 'paper', kind: 'paper', paper });
const penItem = (pen: PenKey): DeskItem => ({ id: `pen.${pen}`, drawer: 'pens', kind: 'pen', pen, font: PENS[pen].font });
const inkItem = (ink: InkKind): DeskItem => ({ id: `ink.${ink}`, drawer: 'pens', kind: 'ink', ink });
const envelopeItem = ({ paper, liner }: EnvelopeStock): DeskItem => ({
  id: `envelope.${paper}.${liner}`,
  drawer: 'envelopes',
  kind: 'envelope',
  paper,
  liner,
});

/**
 * Every item, per drawer, in drawing order: the paper stacks front to back; the three pens
 * (one per groove), then the four bottles left to right; the envelopes front to back.
 */
export const ITEMS_BY_DRAWER: Record<DrawerKey, readonly DeskItem[]> = {
  paper: (['grid', 'seyes', 'cotton', 'airmail'] as const).map(paperItem),
  pens: [...PEN_KEYS.map(penItem), ...(['blueBlack', 'ironGall', 'violet', 'sapphire'] as const).map(inkItem)],
  envelopes: ENVELOPE_STOCK.map(envelopeItem),
};

/** Stationery that an older reader doesn't know: offered only while NEW_STATIONERY is on. */
const NEW_ITEMS: ReadonlySet<DeskItemId> = new Set<DeskItemId>(['paper.seyes', 'paper.airmail', 'ink.sapphire']);

/** The items a drawer offers: `seyes`, `airmail` and `sapphire` are hidden when the flag is off. */
export function itemsFor(
  drawer: DrawerKey,
  { newStationery = NEW_STATIONERY }: { newStationery?: boolean } = {},
): readonly DeskItem[] {
  const items = ITEMS_BY_DRAWER[drawer];
  return newStationery ? items : items.filter((i) => !NEW_ITEMS.has(i.id));
}

/** The item with this id (from `?item=`), or undefined for anything else. */
export function deskItem(id: string | undefined): DeskItem | undefined {
  if (!id) return undefined;
  for (const d of DRAWERS) {
    const found = ITEMS_BY_DRAWER[d].find((i) => i.id === id);
    if (found) return found;
  }
  return undefined;
}

// ---------------------------------------------------------------- seeds

/** The desk is the writer's furniture, not the letter's: one seed per country, the same for every letter. */
export type DeskCountry = Country;
export const deskSeed = (country: DeskCountry) => subSeed(hashString(country), 'desk');
export const itemSeed = (desk: number, id: DeskItemId) => subSeed(desk, id);

// ---------------------------------------------------------------- geometry

/** A rectangle in points; screen coordinates unless a field says otherwise. */
export type Rect = { x: number; y: number; width: number; height: number };

/** The fixed band at the bottom of the screen, top to bottom (pt). */
export type DeskBand = {
  /** y of the band's top (the nosing's top edge) on screen. */
  top: number;
  /** Total height, the bottom safe area included. */
  height: number;
  /** Desk nosing (the lit lip), fronts, rail under them, knee shadow, bottom inset. */
  nosing: number;
  fronts: number;
  rail: number;
  knee: number;
  inset: number;
};

/** One drawer's travel and interior (§3.2). */
export type DrawerGeometry = {
  /** Front travel D: follows the finger 1:1. */
  travel: number;
  /** Interior depth H, already clamped so the desk edge stays below the top inset + 40. */
  depth: number;
  /** Camera pan C = H + D. */
  pan: number;
  /** Interior size (the floor between the walls), pt. */
  interior: { width: number; height: number };
};

/** How the sous-main sits around the sheet. */
export type PadRule = {
  /** Phone: the pad runs off both sides of the screen (no side fillet). */
  fullBleed: boolean;
  /** Margin beside the sheet (laptop) and above/below it, pt. */
  marginX: number;
  marginY: number;
  /** Gilt fillet insets (pt from the pad's edge): one on a phone, two on a laptop. */
  fillets: readonly number[];
  radius: number;
};

export type DeskLayout = {
  mode: 'phone' | 'laptop';
  /** Window size and safe-area insets it was computed for. */
  width: number;
  height: number;
  insets: { top: number; bottom: number; left: number; right: number };
  /** Scales in pt per mm: the desk top (sheet.width / 150) and the apron and drawers. */
  near: number;
  far: number;
  /** The sheet size to write on (what `useSheetSize` gives, capped on a laptop so sheet and band fit). */
  sheet: { width: number; height: number };
  band: DeskBand;
  /** Each closed front on screen. */
  fronts: Record<DrawerKey, Rect>;
  drawers: Record<DrawerKey, DrawerGeometry>;
  pad: PadRule;
  /** Laptop with at least 300 pt beside the pad: the current paper, pen, bottle and envelope lie there. */
  resting: 'sides' | 'none';
};

/** What `deskLayout` needs: the window and its safe-area insets. */
export type DeskLayoutInput = {
  width: number;
  height: number;
  insets: { top: number; bottom: number; left?: number; right?: number };
};

/** Where a resting item lies on the desk top (near scale): its centre, its turn (radians), pt per mm. */
export type Placement = { x: number; y: number; rotation: number; scale: number };
export type RestingPlaces = { paper: Placement; pen: Placement; bottle: Placement; envelope: Placement };

/** One item's place inside an open drawer, in interior coordinates (origin at the interior's top-left). */
export type Slot = {
  item: DeskItem;
  /** The item's drawn rect (unrotated) and its turn in radians. */
  rect: Rect;
  rotation: number;
  /** The touch target: at least 44 × 22 pt. */
  hit: Rect;
  /** Where its caption sits in the floor beside the drawer: the anchor point, and which way the text runs. */
  caption: { x: number; y: number; align: 'left' | 'right' };
  /** In use (in hand or on the desk): drawn as an empty groove or an ink ring, caption with the «in use» note. */
  inUse: boolean;
};

// ---------------------------------------------------------------- picking (§4)

/** What is on the desk now: the paper, the pen in hand (from the font), the open bottle, the envelope set aside. */
export type InUse = { paper: PaperKind; pen: PenKey; ink: InkKind; envelope: EnvelopeStock };
/** The laptop's resting items show exactly what is in use. */
export type RestingLook = InUse;

export const inUseOf = (look: Pick<LetterLook, 'paper' | 'ink' | 'font'>, envelope: EnvelopeStock): InUse => ({
  paper: look.paper,
  pen: penFor(look.font),
  ink: look.ink,
  envelope,
});

/** Lines the hint strip can show (copy in `DESK_COPY[lang].hints`). */
export type HintKey =
  | 'firstPull'
  | 'opened.paper'
  | 'opened.pens'
  | 'opened.envelopes'
  | 'nextSheet'
  | 'blankWaiting'
  | 'full'
  | 'paperLocked'
  | 'penLocked'
  | 'inkLocked'
  | 'sealedConfirm';

export type PickState = {
  /** typing: demo || sheets.every(isEmptySheet); journey: sheets.every(isEmptySheet). */
  blank: boolean;
  /** paper, ink, font, seed. */
  look: LetterLook;
  sheets: SheetContent[];
  /** maxSheetsFor(fold), MULTI_SHEET respected. */
  maxSheets: number;
  envelope: EnvelopeStock;
  /** getDraft()?.envelope present (journey: envelope.seal present). */
  sealed: boolean;
};

export type PickOutcome =
  | {
      kind: 'apply';
      look?: LetterLook;
      sheets?: SheetContent[];
      /** Lay a new blank sheet of the same paper (DeskStack's slide turn). */
      addSheet?: true;
      envelope?: EnvelopeStock;
      /** The letter was sealed: drop its envelope, it must be sealed again. */
      unseal?: true;
      hint?: HintKey;
    }
  | { kind: 'refuse'; hint: HintKey }
  | { kind: 'confirm'; hint: 'sealedConfirm' };

// ---------------------------------------------------------------- carrying (§3.5)

/**
 * The item being carried or flying, on the UI thread. `idle`: nothing; `lift`: rising out of its slot;
 * `carry`: under the pointer; `fly`: to its destination after a take; `home`: springing back to its slot;
 * `wiggle`: a refusal. x, y are the item's centre on screen; grab is the pointer's offset from it.
 */
export type CarryPhase = 'idle' | 'lift' | 'carry' | 'fly' | 'home' | 'wiggle';
export type CarryState = {
  phase: CarryPhase;
  x: number;
  y: number;
  grabX: number;
  grabY: number;
  /** Release velocity (pt/s), for the fly spring and the tilt. */
  vx: number;
  vy: number;
  /** A finger (rides 56 pt above it) or a mouse (stays at the grab offset). */
  touch: boolean;
};

// ---------------------------------------------------------------- component props (§7)

export type DeskSceneProps = {
  lang: Lang;
  country: Country;
  seed: number;
  layout: DeskLayout;
  title?: string;
  hint?: string;
  /** Journey Progress, the mode Choice. */
  header?: ReactNode;
  /** The DeskStack (measured for the sous-main). */
  sheet: ReactNode;
  /** Links and buttons under the sheet. */
  children?: ReactNode;
  /** What is in use (drawer gaps, laptop items). */
  look: LetterLook;
  envelope: EnvelopeStock;
  /** Captions at 60 %. */
  locked: { paper: boolean; pen: boolean; ink: boolean };
  /** From DeskStack onEditing / onBusy. */
  editing: boolean;
  busy: boolean;
  onPick: (item: DeskItem, confirmed?: boolean) => PickOutcome;
  /** QA freeze: ?drawer, ?dt, ?item, ?kb, ?rm. */
  fixed?: { drawer?: DrawerKey; t?: number; item?: string; kb?: boolean; rm?: boolean };
};

export type UnderlayProps = {
  layout: DeskLayout;
  preset: Country;
  seed: number;
  sheetRect: Rect | null;
  contentHeight: number;
  resting: RestingLook | null;
};

export type ApronProps = { layout: DeskLayout; preset: Country; seed: number; lang: Lang };
export type ApronCanvasProps = ApronProps;

export type DrawerBoxProps = {
  drawer: DrawerKey;
  layout: DeskLayout;
  preset: Country;
  seed: number;
  inUse: InUse;
  /** An item id shown lifted in its slot (?item=). */
  lifted?: string;
};

export type CarryLayerProps = {
  layout: DeskLayout;
  preset: Country;
  seed: number;
  carry: SharedValue<CarryState>;
  item: DeskItem | null;
  destination: Rect | null;
};
