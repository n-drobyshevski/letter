import { local, type EventCode, type Itinerary, type TrackingEvent } from './itinerary';

/**
 * Tracking copy. Two voices per scan:
 *  - the OFFICIAL line, as the post office of that leg prints it (French legs in
 *    French, La Poste style; Belarusian legs in Russian, Belpost style), and
 *  - a short NOTE in the viewer's language, written like a friend reading the tracking.
 */

export type Lang = 'ru' | 'fr';

const OFFICIAL: Partial<Record<EventCode, { lang: Lang; text: string }>> = {
  EMA: { lang: 'fr', text: 'Votre envoi est pris en charge par La Poste.' },
  EDD: { lang: 'fr', text: 'Votre envoi est trié sur sa plateforme de départ.' },
  EMB: { lang: 'fr', text: 'Votre envoi est arrivé au bureau d’échange du pays d’expédition.' },
  EMC: { lang: 'fr', text: 'Votre envoi a quitté la France.' },
  XBH: { lang: 'ru', text: 'Граница временно закрыта, отправление ожидает.' },
  EMD: { lang: 'ru', text: 'Поступило в учреждение международного почтового обмена.' },
  EDB: { lang: 'ru', text: 'Передано на таможенный контроль (ПТО «Минская почта»).' },
  EDC: { lang: 'ru', text: 'Таможенный контроль завершён.' },
  EMF: { lang: 'ru', text: 'Отправлено из учреждения обмена.' },
  EMG: { lang: 'ru', text: 'Поступило в учреждение доставки.' },
  EMI: { lang: 'ru', text: 'Вручено адресату.' },
};

const NOTES: Partial<Record<EventCode, Record<Lang, string>>> = {
  EMA: { ru: 'Письмо забрали из ящика', fr: 'Ta lettre a quitté la boîte jaune' },
  EDD: { ru: 'Ночью его рассортировали', fr: 'Triée cette nuit à Lesquin' },
  EMB: { ru: 'Ждёт машину на восток', fr: 'Elle attend le camion pour l’Est' },
  EMC: { ru: 'Покинуло Францию', fr: 'Elle a quitté la France' },
  XBH: { ru: 'Граница закрыта, письмо терпеливо ждёт', fr: 'La frontière est fermée, elle patiente' },
  EMD: { ru: 'Уже в Минске!', fr: 'Elle est à Minsk !' },
  EDB: { ru: 'Не вскрывали — просто смотрят на марки', fr: 'On regarde juste les timbres' },
  EDC: { ru: 'Таможня пропустила', fr: 'La douane l’a laissée passer' },
  EMF: { ru: 'Едет в твоё отделение', fr: 'En route vers ton bureau de poste' },
  EMG: { ru: 'Совсем рядом, в твоём отделении', fr: 'Presque chez toi' },
  EMI: { ru: 'В твоём ящике', fr: 'Dans ta boîte' },
};

export const official = (code: EventCode) => OFFICIAL[code];
export const note = (code: EventCode, lang: Lang) => NOTES[code]?.[lang] ?? '';

const MONTHS: Record<Lang, string[]> = {
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
};
const SHORT: Record<Lang, string[]> = {
  ru: ['янв.', 'фев.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сен.', 'окт.', 'нояб.', 'дек.'],
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
};

const pad = (n: number) => String(n).padStart(2, '0');

/** "28 окт." / "28 oct." */
export function shortDate(ms: number, tz: string, lang: Lang) {
  const l = local(ms, tz);
  return `${l.d} ${SHORT[lang][l.m - 1]}`;
}

export function clock(ms: number, tz: string) {
  const l = local(ms, tz);
  return `${pad(l.h)}:${pad(l.mi)}`;
}

/** "19 ноября" from a YYYY-MM-DD day key. */
function longDay(key: string, lang: Lang) {
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS[lang][m - 1]}`;
}

/** A fixed arrival (express, standard, scheduled): "Придёт 29 октября около 10:00". */
export function arrivalLine(deliverAt: string, lang: Lang, recipientTz: string) {
  const at = Date.parse(deliverAt);
  return lang === 'ru'
    ? `Придёт ${longDay(local(at, recipientTz).key, 'ru')} около ${clock(at, recipientTz)}`
    : `Arrivée le ${longDay(local(at, recipientTz).key, 'fr')} vers ${clock(at, recipientTz).replace(':', ' h ')}`;
}

/** The promise made at posting. */
export function windowLine(it: Itinerary, lang: Lang, recipientTz: string) {
  if (it.tier !== 'postal') return arrivalLine(it.deliverAt, lang, recipientTz);
  const { lo, hi } = it.window;
  if (lo === hi) return lang === 'ru' ? `Придёт ${longDay(lo, 'ru')}` : `Arrivée le ${longDay(lo, 'fr')}`;
  // "между 19 и 26 ноября", but "между 30 октября и 5 ноября" across months.
  const sameMonth = lo.slice(0, 7) === hi.slice(0, 7);
  const from = (l: Lang) => (sameMonth ? longDay(lo, l).replace(/ .*/, '') : longDay(lo, l));
  return lang === 'ru' ? `Придёт между ${from('ru')} и ${longDay(hi, 'ru')}` : `Arrivée entre le ${from('fr')} et le ${longDay(hi, 'fr')}`;
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/**
 * Honest silence: real tracking goes quiet between countries and inside a busy
 * exchange office. Shown when the last scan is a day old or more.
 */
export function silenceLine(last: TrackingEvent, now: number, lang: Lang): string | null {
  if (last.code === 'EMI') return null;
  const days = Math.floor((now - Date.parse(last.at)) / 864e5);
  if (days < 1) return null;
  const why: Record<Lang, string> =
    last.code === 'EMC' || last.code === 'XBH'
      ? { ru: 'между странами письма не сканируют', fr: 'entre deux pays, le suivi se tait' }
      : last.code === 'EMB'
        ? { ru: 'ждёт отправки на восток', fr: 'elle attend le départ vers l’Est' }
        : last.code === 'EMD' || last.code === 'EDB' || last.code === 'EDC'
          ? { ru: 'в Минске письма бывают по нескольку дней', fr: 'à Minsk, le tri prend parfois plusieurs jours' }
          : { ru: 'почта не торопится', fr: 'la poste prend son temps' };
  return lang === 'ru'
    ? `Нет новостей ${days} ${plural(days, 'день', 'дня', 'дней')} — ${why.ru}`
    : `Pas de nouvelles depuis ${days} jour${days > 1 ? 's' : ''} — ${why.fr}`;
}

/** A11y summary of the map: distance done and where the last scan was. */
export function mapSummary(doneKm: number, totalKm: number, place: string, lang: Lang) {
  const r = (n: number) => Math.round(n / 50) * 50;
  return lang === 'ru'
    ? `Пройдено около ${r(doneKm)} из ${r(totalKm)} км, последнее сканирование: ${place}`
    : `Environ ${r(doneKm)} km sur ${r(totalKm)}, dernier scan : ${place}`;
}
