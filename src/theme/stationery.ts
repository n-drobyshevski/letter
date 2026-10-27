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
  /**
   * Show-through: how dark the other face's ink reads through the sheet (multiplied, 0..1).
   * From opacity: ~60 g notebook paper 10–15 %, copy paper 6–10 %, 100–120 g cotton 3–5 % (a touch more here: a ghost too faint to see is no cue).
   */
  showThrough: number;
  /** How far light scatters inside the sheet, blurring that ghost (px on a ~440 px sheet, ≈ 0.2 mm). */
  ghostBlur: number;
};

export const PAPERS: Record<PaperKind, PaperSpec> = {
  // Школьная тетрадь в клетку: grey-blue 5 mm grid, red/pink margin.
  grid: {
    kind: 'grid',
    showThrough: 0.1,
    ghostBlur: 0.9,
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
    showThrough: 0.06,
    ghostBlur: 1.3,
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
    showThrough: 0.06,
    ghostBlur: 1.2,
    base: [0.94, 0.905, 0.83],
    cell: 0,
    marginX: 0,
    gridColor: [0, 0, 0],
    marginColor: [0, 0, 0],
    bleed: 0.5,
  },
  kraft: {
    kind: 'kraft',
    showThrough: 0.04,
    ghostBlur: 1.4,
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

/**
 * Traditional sealing wax is brittle: it can crack in the post and snaps when opened.
 * Modern flexible wax (glue-gun sticks) survives the post, bends, and peels off whole.
 */
export const WAX_TYPES = {
  brittle: { label: 'Сургуч' },
  flexible: { label: 'Гибкий воск' },
} as const;
export type WaxType = keyof typeof WAX_TYPES;

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

/** Printed matter: envelope fields, stamps, postmarks, postbox signage. PT Sans was made for Russian. */
export const PRINT_FONTS = {
  regular: require('@expo-google-fonts/pt-sans-narrow/400Regular/PTSansNarrow_400Regular.ttf'),
  bold: require('@expo-google-fonts/pt-sans-narrow/700Bold/PTSansNarrow_700Bold.ttf'),
};

/** Street postboxes on the Minsk side: the blue wall box; yellow marks the express tier (a cue of ours). */
export const POSTBOX = {
  blue: { face: [0.153, 0.4, 0.773] as Rgb, side: '#1a499f', shade: '#153774' },
  yellow: { face: [1, 0.765, 0.082] as Rgb, side: '#d99a00', shade: '#a87400' },
  primer: [0.54, 0.553, 0.565] as Rgb,
  slotLip: '#f6974a',
  slotInside: ['#0b0b0d', '#1c1c20'],
  wall: [0.6, 0.58, 0.55] as Rgb,
};
export type PostboxSkin = 'blue' | 'yellow';

/**
 * Whose post office: the sender's for the postbox and the envelope, the recipient's for the mailbox.
 * 'by' is Belarus (Minsk); the language of the copy is a separate thing (Lang, 'ru' | 'fr').
 */
export type Country = 'by' | 'fr';
/** The language people use with that post office: French in France, Russian in Minsk. */
export const langOf = (c: Country): 'ru' | 'fr' => (c === 'fr' ? 'fr' : 'ru');

/** French street box: La Poste yellow (#FFCB05). No logo: original signage only. */
export const POSTBOX_FR = {
  face: [1, 0.796, 0.02] as Rgb,
  side: '#d4a300',
  band: '#1d3f8f',
};

/** French collective mailbox ("batterie"), anthracite RAL 7016. */
export const MAILBOX_FR = {
  face: [0.22, 0.243, 0.259] as Rgb,
  frame: [0.18, 0.2, 0.215] as Rgb,
  primer: [0.5, 0.5, 0.5] as Rgb,
  nameplate: '#f2efe6',
};

/** Подъезд mailbox bank (RAL 7035 light grey) and its interior. */
export const MAILBOX = {
  face: [0.796, 0.816, 0.8] as Rgb,
  frame: [0.62, 0.64, 0.63] as Rgb,
  primer: [0.42, 0.43, 0.44] as Rgb,
  interior: '#2a2622',
  wall: [0.72, 0.7, 0.62] as Rgb,
};

/** Post-office inks and printing (postage.ts draws the stamps and postmarks). */
export const POSTAL = {
  printedFields: 'rgba(52, 62, 86, 0.75)',
  stampPaper: '#f3efe4',
  /** Belarusian definitive: pale ground, dark printed lettering. */
  byStampGround: '#f2efe2',
  byStampText: '#1f2a24',
  /** The calendar postmark struck by hand in Minsk: violet-blue ink. */
  handPostmarkInk: [0.2, 0.19, 0.46] as Rgb,
  /** The blue UPU priority label. */
  priorityLabel: '#2b5aa6',
  /** France's «Lettre internationale» stamp. */
  frInternational: '#5b3c8e',
  /** French sorting machines print their postmark in black inkjet. */
  inkjet: 'rgba(22, 22, 26, 0.9)',
};

/** The single desk light: from the top-left, slightly in front (defined with the Skia-free sheet geometry). */
export { LIGHT_DIR } from '../letter/paperLayout';

export const DESK = {
  background: '#2a211b',
  wood: '#3a2c22',
};
