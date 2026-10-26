import type { EnvelopeFormat } from './envelope';
import type { Address, Postmark } from './envelopeFront';
import type { FoldKind } from './fold';
import type { LetterLook } from './LetterSheet';
import type { Stroke } from './strokes';
import type { Country, FontKey, InkKind, PaperKind, WaxKind, WaxType } from '../theme/stationery';

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
    wax?: string;
    waxType?: string;
    initials?: string;
    seed?: number;
    format?: string;
    postmark?: { city?: string; date?: string };
  } | null;
};

export type ContentRow = {
  letter_id: string;
  body: { text?: string; strokes?: Stroke[]; sheet_width?: number; font?: string; ink?: string; paper?: string; fold?: string } | null;
};

export type ReceiptRow = { letter_id: string; opened_at: string };

export type Person = { id: string; display_name: string; city: string; tz: string };

export type MailLetter = {
  id?: string;
  seed: number;
  text: string;
  /** Pen strokes (signature, P.S.), in pixels of a sheet strokesWidth wide. */
  strokes?: Stroke[];
  strokesWidth?: number;
  letterLook?: Omit<LetterLook, 'seed'>;
  /** How the sender folded it; the recipient unfolds it the same way. */
  fold?: FoldKind;
  /** The envelope it came in, sized for the fold. */
  format?: EnvelopeFormat;
  paper: PaperKind;
  wax: WaxKind;
  waxType: WaxType;
  initials: string;
  address: Address;
  postmark: Postmark;
  senderCountry: Country;
  fromLabel: { name: string; city: string };
  deliverAt?: string;
  openedAt?: string;
};

// Runtime whitelists (stationery.ts itself loads font files, so it can't be imported here).
const PAPERS: PaperKind[] = ['grid', 'cotton', 'cream', 'kraft'];
const ENVELOPE_PAPERS: PaperKind[] = ['cream', 'kraft'];
const WAXES: WaxKind[] = ['bordeaux', 'forest', 'navy', 'gold'];
const INKS: InkKind[] = ['blueBlack', 'ironGall', 'violet'];
const FONTS: FontKey[] = ['badScript', 'marckScript', 'caveat'];
const FOLDS: FoldKind[] = ['tri', 'half', 'quarter'];
const FORMATS: EnvelopeFormat[] = ['DL', 'C5', 'C6'];
const FORMAT_OF: Record<FoldKind, EnvelopeFormat> = { tri: 'DL', half: 'C5', quarter: 'C6' };
const pick = <T extends string>(v: string | undefined, allowed: T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

/** Which post office a person uses: French boxes in France, the Russian/Belarusian kind otherwise. */
export const countryOf = (tz: string): Country => (tz === 'Europe/Paris' ? 'fr' : 'ru');

/** The destination country as the sender would write it, or nothing within one country. */
function countryLine(recipientTz: string, senderTz: string): string | undefined {
  if (recipientTz === senderTz) return undefined;
  const writer = countryOf(senderTz);
  const names: Record<string, Record<Country, string>> = {
    'Europe/Minsk': { fr: 'Biélorussie', ru: 'Беларусь' },
    'Europe/Paris': { fr: 'France', ru: 'Франция' },
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
    return {
      id: r.id,
      seed: env.seed ?? r.seed,
      text: b?.text ?? '',
      strokes: b?.strokes?.length ? b.strokes : undefined,
      strokesWidth: b?.sheet_width,
      letterLook: {
        paper: pick(b?.paper, PAPERS, 'cotton'),
        ink: pick(b?.ink, INKS, 'blueBlack'),
        font: pick(b?.font, FONTS, 'badScript'),
      },
      fold,
      format: pick(env.format, FORMATS, FORMAT_OF[fold]),
      paper: pick(env.paper, ENVELOPE_PAPERS, 'cream'),
      wax: pick(env.wax, WAXES, 'bordeaux'),
      waxType: env.waxType === 'flexible' ? 'flexible' : 'brittle',
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
