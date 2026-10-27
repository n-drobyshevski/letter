/**
 * The stationery kinds as plain lists: pure, no `require`, so the server-row parser
 * (`mailboxFromServer.ts`), the desk's drawers and node tests share one whitelist.
 * `stationery.ts` derives its `PaperKind` and `InkKind` from these.
 */

/** Papers a letter is written on. */
export const SHEET_PAPERS = ['grid', 'cotton', 'seyes', 'airmail'] as const;
/** Envelope stock. */
export const ENVELOPE_PAPERS = ['cream', 'kraft'] as const;
export const PAPER_KINDS = [...SHEET_PAPERS, ...ENVELOPE_PAPERS] as const;
export const INK_KINDS = ['blueBlack', 'ironGall', 'violet', 'sapphire'] as const;
export const FONT_KEYS = ['badScript', 'marckScript', 'caveat'] as const;
export const LINER_KINDS = ['postal', 'bordeaux', 'forest'] as const;
export const WAX_KINDS = ['bordeaux', 'forest', 'navy', 'gold'] as const;

export type SheetPaper = (typeof SHEET_PAPERS)[number];
export type EnvelopePaper = (typeof ENVELOPE_PAPERS)[number];
export type PaperKind = (typeof PAPER_KINDS)[number];
export type InkKind = (typeof INK_KINDS)[number];
export type FontKey = (typeof FONT_KEYS)[number];
export type LinerKind = (typeof LINER_KINDS)[number];
export type WaxKind = (typeof WAX_KINDS)[number];

/**
 * New stationery (seyes, airmail, sapphire) offered in the drawers. An older reader lays an unknown
 * paper out as cotton: Seyès has ~19 lines to cotton's ~14, so words would be lost. Turn on only
 * once both phones run a build that knows them (like MULTI_SHEET).
 */
export const NEW_STATIONERY = true;
