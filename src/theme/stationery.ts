/**
 * Stationery tokens. See .claude/skills/paper-realism for the rules behind them:
 * never pure white paper, never pure black ink, one light direction for the whole desk.
 */

export type Rgb = readonly [number, number, number];

export type PaperKind = 'grid' | 'cotton' | 'cream' | 'kraft';

export type PaperSpec = {
  kind: PaperKind;
  /** Base paper colour, linear-ish 0..1 */
  base: Rgb;
  /** Grid cell size in px at the 1x layout scale; 0 = no grid. Russian notebook: 5 mm. */
  cell: number;
  /** x of the margin rule in px, or 0 for none. */
  marginX: number;
  /** Printed rule colours. */
  gridColor: Rgb;
  marginColor: Rgb;
  /** How strongly ink feathers into this paper (0..1). */
  bleed: number;
};

export const PAPERS: Record<PaperKind, PaperSpec> = {
  // Школьная тетрадь в клетку: grey-blue 5 mm grid, red/pink margin.
  grid: {
    kind: 'grid',
    base: [0.965, 0.955, 0.93],
    cell: 19,
    marginX: 0, // set from sheet width at layout time (right-hand margin, as in a real notebook)
    gridColor: [0.55, 0.65, 0.78],
    marginColor: [0.86, 0.4, 0.46],
    bleed: 0.35,
  },
  // Cotton writing paper: warm, no rules, slightly stronger fibres.
  cotton: {
    kind: 'cotton',
    base: [0.955, 0.93, 0.88],
    cell: 0,
    marginX: 0,
    gridColor: [0, 0, 0],
    marginColor: [0, 0, 0],
    bleed: 0.6,
  },
  // Envelope stock.
  cream: {
    kind: 'cream',
    base: [0.94, 0.905, 0.83],
    cell: 0,
    marginX: 0,
    gridColor: [0, 0, 0],
    marginColor: [0, 0, 0],
    bleed: 0.5,
  },
  kraft: {
    kind: 'kraft',
    base: [0.76, 0.6, 0.43],
    cell: 0,
    marginX: 0,
    gridColor: [0, 0, 0],
    marginColor: [0, 0, 0],
    bleed: 0.7,
  },
};

/** Inside of the envelope: base paper and the printed security pattern. */
export const LINERS = {
  postal: { label: 'Почтовый', base: [0.87, 0.88, 0.9] as Rgb, pattern: [0.5, 0.55, 0.7] as Rgb, scale: 6 },
  bordeaux: { label: 'Бордо', base: [0.42, 0.12, 0.16] as Rgb, pattern: [0.62, 0.48, 0.3] as Rgb, scale: 9 },
  forest: { label: 'Лес', base: [0.16, 0.27, 0.21] as Rgb, pattern: [0.72, 0.64, 0.45] as Rgb, scale: 9 },
} as const;
export type LinerKind = keyof typeof LINERS;

export const WAX = {
  bordeaux: { label: 'Бордо', rgb: [0.48, 0.07, 0.1] as Rgb },
  forest: { label: 'Зелёный', rgb: [0.1, 0.27, 0.18] as Rgb },
  navy: { label: 'Синий', rgb: [0.1, 0.15, 0.33] as Rgb },
  gold: { label: 'Золото', rgb: [0.62, 0.47, 0.2] as Rgb },
} as const;
export type WaxKind = keyof typeof WAX;

export type InkKind = 'blueBlack' | 'ironGall' | 'violet';

export const INKS: Record<InkKind, { label: string; color: string; rgb: Rgb }> = {
  blueBlack: { label: 'Сине-чёрные', color: '#1f2b4d', rgb: [0.122, 0.169, 0.302] },
  ironGall: { label: 'Железо-галловые', color: '#3b2a22', rgb: [0.231, 0.165, 0.133] },
  violet: { label: 'Фиолетовые', color: '#41306e', rgb: [0.255, 0.188, 0.431] },
};

/** Fonts with full Cyrillic + French coverage (verified glyph-by-glyph, see tests/fonts). */
export const HANDWRITING_FONTS = {
  badScript: {
    label: 'Bad Script',
    file: require('@expo-google-fonts/bad-script/400Regular/BadScript_400Regular.ttf'),
    family: 'BadScript_400Regular',
  },
  marckScript: {
    label: 'Marck Script',
    file: require('@expo-google-fonts/marck-script/400Regular/MarckScript_400Regular.ttf'),
    family: 'MarckScript_400Regular',
  },
  caveat: {
    label: 'Caveat',
    file: require('@expo-google-fonts/caveat/400Regular/Caveat_400Regular.ttf'),
    family: 'Caveat_400Regular',
  },
} as const;

export type FontKey = keyof typeof HANDWRITING_FONTS;

/** The single desk light: from the top-left, slightly in front. */
export const LIGHT_DIR = { x: -0.45, y: -0.75 } as const;

export const DESK = {
  background: '#2a211b',
  wood: '#3a2c22',
};
