import type { EnvelopeFormat } from './envelope';
import type { Address, Postmark } from './envelopeFront';
import type { FoldKind } from './fold';
import type { LetterLook } from './LetterSheet';
import { parseDie, parseSeal, type SealDie, type SealPlacement } from './seal';
import { MAX_SHEETS, emptyFace, type FaceContent, type SheetContent } from './stack';
import type { Stroke } from './strokes';
import { ENVELOPE_PAPERS, FONT_KEYS, INK_KINDS, LINER_KINDS, PAPER_KINDS, WAX_KINDS } from '../theme/kinds';
import type { Country, LinerKind, PaperKind, WaxKind, WaxType } from '../theme/stationery';

/**
 * The recipient's mailbox, from what RLS lets them read: envelopes once collected,
 * contents once delivered, their own receipts. Pure (no Skia, no Supabase) so it
 * can be tested in node; the screen turns MailLetter into pictures.
 */

export type MailRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  deliver_at: string;
  retrieved_at: string | null;
  seed: number;
  envelope: {
    paper?: string;
    liner?: string;
    wax?: string;
    waxType?: string;
    /** The brass die (sealDies.ts); absent on old letters. */
    die?: string;
    /** Where the wax and the die went (seal.ts's SealPlacement); untrusted, absent on old letters. */
    seal?: unknown;
    initials?: string;
    seed?: number;
    format?: string;
    postmark?: { city?: string; date?: string };
  } | null;
};

export type ContentRow = {
  letter_id: string;
  body: {
    text?: string;
    strokes?: Stroke[];
    sheet_width?: number;
    font?: string;
    ink?: string;
    paper?: string;
    fold?: string;
    /** The seed the sender's desk laid the words out with. */
    seed?: number;
    /** schema_v 2: the rest of a longer letter (sheets[0] holds only sheet 1's verso). */
    sheets?: unknown;
    schema_v?: number;
  } | null;
};

export type ReceiptRow = { letter_id: string; opened_at: string };

export type Person = { id: string; display_name: string; city: string; tz: string };

export type MailLetter = {
  id?: string;
  seed: number;
  /** The seed the sheets were written with, when it differs from the envelope's. */
  sheetSeed?: number;
  /** Sheet 1's recto (also sheets[0].recto). */
  text: string;
  /** Pen strokes (signature, P.S.), in pixels of a sheet strokesWidth wide. */
  strokes?: Stroke[];
  /** Every sheet, front and back; absent means one sheet holding `text` and `strokes`. */
  sheets?: SheetContent[];
  strokesWidth?: number;
  letterLook?: Omit<LetterLook, 'seed'>;
  /** How the sender folded it; the recipient unfolds it the same way. */
  fold?: FoldKind;
  /** The envelope it came in, sized for the fold. */
  format?: EnvelopeFormat;
  paper: PaperKind;
  /** Inside of the envelope; the postal pattern when not recorded. */
  liner: LinerKind;
  wax: WaxKind;
  waxType: WaxType;
  /** The engraving on the seal; the monogram when not recorded. */
  die: SealDie;
  /** Where the sender poured the wax and pressed the die; undefined on old letters (today's seal, seal.ts's defaultSeal). */
  seal?: SealPlacement;
  initials: string;
  address: Address;
  postmark: Postmark;
  senderCountry: Country;
  fromLabel: { name: string; city: string };
  deliverAt?: string;
  openedAt?: string;
};

// Runtime whitelists come from kinds.ts (stationery.ts itself loads font files, so it can't be imported here).
// A sheet accepts every paper kind, envelope stock included, as it always has: old letters parse the same.
const FOLDS: FoldKind[] = ['tri', 'half', 'quarter'];
const FORMATS: EnvelopeFormat[] = ['DL', 'C5', 'C6'];
const FORMAT_OF: Record<FoldKind, EnvelopeFormat> = { tri: 'DL', half: 'C5', quarter: 'C6' };
const pick = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

const asFace = (v: unknown): FaceContent | null => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const f = v as { text?: unknown; strokes?: unknown };
  return {
    text: typeof f.text === 'string' ? f.text : '',
    strokes: Array.isArray(f.strokes) ? (f.strokes.filter(Array.isArray) as Stroke[]) : [],
  };
};

/**
 * The sheets of a letter body, schema_v 1 or 2, from whatever the server holds:
 * never trusts the shape, never more than MAX_SHEETS, always at least sheet 1.
 */
export function parseSheets(b: ContentRow['body']): SheetContent[] {
  const first: FaceContent = {
    text: typeof b?.text === 'string' ? b.text : '',
    strokes: Array.isArray(b?.strokes) ? b.strokes.filter(Array.isArray) : [],
  };
  const raw = Array.isArray(b?.sheets) ? b.sheets.slice(0, MAX_SHEETS) : [];
  const sheets: SheetContent[] = [{ recto: first, verso: asFace((raw[0] as { verso?: unknown } | undefined)?.verso) ?? emptyFace(), twoSided: false }];
  for (const entry of raw.slice(1)) {
    const recto = asFace((entry as { recto?: unknown } | null)?.recto);
    if (!recto) continue;
    sheets.push({ recto, verso: asFace((entry as { verso?: unknown }).verso) ?? emptyFace(), twoSided: false });
  }
  for (const sheet of sheets) sheet.twoSided = sheet.verso.text !== '' || sheet.verso.strokes.length > 0;
  return sheets;
}

/** A letter's sheets, also for letters built by hand (labs) with only `text` and `strokes`. */
export const sheetsOf = (l: Pick<MailLetter, 'text' | 'strokes' | 'sheets'>): SheetContent[] =>
  l.sheets?.length ? l.sheets : [{ recto: { text: l.text, strokes: l.strokes ?? [] }, verso: emptyFace(), twoSided: false }];

/** Which post office a person uses: French boxes in France, the Belarusian kind otherwise (Minsk). */
export const countryOf = (tz: string): Country => (tz === 'Europe/Paris' ? 'fr' : 'by');

/**
 * The destination country as the sender would write it, or nothing within one country.
 * Abroad from Minsk it goes in Latin letters, as the post asks for an international address.
 */
function countryLine(recipientTz: string, senderTz: string): string | undefined {
  if (recipientTz === senderTz) return undefined;
  const writer = countryOf(senderTz);
  const names: Record<string, Record<Country, string>> = {
    'Europe/Minsk': { fr: 'Biélorussie', by: 'Беларусь' },
    'Europe/Paris': { fr: 'France', by: 'France' },
  };
  return names[recipientTz]?.[writer];
}

export function mailboxFromServer(input: {
  rows: MailRow[];
  contents: ContentRow[];
  receipts: ReceiptRow[];
  me: Person;
  them: Person | null;
  now: number;
}): { waiting: MailLetter[]; opened: MailLetter[]; nextAt: number | null } {
  const { rows, contents, receipts, me, them, now } = input;
  const body = new Map(contents.map((c) => [c.letter_id, c.body]));
  const openedAt = new Map(receipts.map((r) => [r.letter_id, r.opened_at]));
  const mine = rows
    .filter((r) => r.recipient_id === me.id && !r.retrieved_at)
    .sort((a, b) => Date.parse(a.deliver_at) - Date.parse(b.deliver_at));

  const delivered = mine.filter((r) => Date.parse(r.deliver_at) <= now);
  const upcoming = mine.filter((r) => Date.parse(r.deliver_at) > now);

  const toLetter = (r: MailRow): MailLetter => {
    const sender = them && r.sender_id === them.id ? them : { id: r.sender_id, display_name: '', city: '', tz: me.tz };
    const b = body.get(r.id) ?? null;
    const env = r.envelope ?? {};
    const fold = pick(b?.fold, FOLDS, 'tri');
    const sheets = parseSheets(b);
    return {
      id: r.id,
      // The envelope is client-written jsonb: only a real integer seeds the seal's outline (r.seed is an int column).
      seed: Number.isSafeInteger(env.seed) ? (env.seed as number) : r.seed,
      sheetSeed: typeof b?.seed === 'number' && Number.isFinite(b.seed) ? b.seed : undefined,
      text: sheets[0].recto.text,
      strokes: sheets[0].recto.strokes.length ? sheets[0].recto.strokes : undefined,
      sheets: sheets.length > 1 || sheets[0].twoSided ? sheets : undefined,
      strokesWidth: b?.sheet_width,
      letterLook: {
        paper: pick(b?.paper, PAPER_KINDS, 'cotton'),
        ink: pick(b?.ink, INK_KINDS, 'blueBlack'),
        font: pick(b?.font, FONT_KEYS, 'badScript'),
      },
      fold,
      format: pick(env.format, FORMATS, FORMAT_OF[fold]),
      paper: pick(env.paper, ENVELOPE_PAPERS, 'cream'),
      liner: pick(env.liner, LINER_KINDS, 'postal'),
      wax: pick(env.wax, WAX_KINDS, 'bordeaux'),
      waxType: env.waxType === 'flexible' ? 'flexible' : 'brittle',
      die: parseDie(env.die),
      seal: parseSeal(env.seal) ?? undefined,
      initials: env.initials || sender.display_name.charAt(0) || '·',
      address: {
        fromName: sender.display_name,
        fromCity: sender.city,
        toName: me.display_name,
        toCity: me.city,
        toCountry: countryLine(me.tz, sender.tz),
      },
      postmark: {
        city: env.postmark?.city || sender.city,
        date: env.postmark?.date || r.deliver_at.slice(0, 10),
      },
      senderCountry: countryOf(sender.tz),
      fromLabel: { name: sender.display_name, city: sender.city },
      deliverAt: r.deliver_at,
      openedAt: openedAt.get(r.id),
    };
  };

  const letters = delivered.map(toLetter);
  return {
    waiting: letters.filter((l) => !l.openedAt),
    // The shoebox: most recently opened first.
    opened: letters.filter((l) => l.openedAt).sort((a, b) => Date.parse(b.openedAt!) - Date.parse(a.openedAt!)),
    nextAt: upcoming.length ? Date.parse(upcoming[0].deliver_at) : null,
  };
}
