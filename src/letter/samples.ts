import type { SheetContent } from './stack';

/** Test copy that exercises Cyrillic (ё, й, щ, ъ) and French accents/ligatures together. */
export const SAMPLE_LETTER = `Моя хорошая,

    пишу тебе вечером, за окном шуршит дождь, а чай уже остыл. Съешь же ещё этих мягких французских булок, да выпей чаю — помнишь, как мы смеялись над этой фразой?

    Je pense à toi, mon cœur. Voix ambiguë d'un cœur qui au zéphyr préfère les jattes de kiwis.

    Жду твоего письма. Целую,
твой Н.`;

export const PANGRAMS = {
  ru: 'Съешь же ещё этих мягких французских булок, да выпей чаю',
  fr: "Voix ambiguë d'un cœur qui au zéphyr préfère les jattes de kiwis",
};

export const SAMPLE_LETTER_FR = `Mon cœur,

    il pleut sur Paris ce soir et je pense à toi. J'ai trouvé une petite boulangerie rue des Martyrs, je t'y emmènerai — promis.

    Ton accent quand tu dis « merci » me manque. Écris-moi vite, même trois lignes.

Je t'embrasse,
M.`;

/** Shorter notes for the mailbox queue: RU and FR, a few lines each. */
export const SHORT_NOTES = {
  ru: [
    `Привет!\n\n    Просто так. Нашёл в кармане билет с нашего кино и улыбался весь день.\n\nТвой Н.`,
    `Доброе утро.\n\n    Сегодня снег — первый. Ты бы ему обрадовалась. Шлю тебе одну снежинку (не растаяла по дороге?).\n\nН.`,
    `Котёнок,\n\n    считаю дни. Осталось двенадцать. Это совсем немного, правда?\n\nЦелую.`,
  ],
  fr: [
    `Coucou,\n\n    juste un mot : le café d'en bas a enfin ton gâteau au citron. Je l'ai goûté pour toi.\n\nM.`,
    `Bonjour toi,\n\n    il fait froid, j'ai mis ton écharpe. Elle sent encore un peu ton parfum.\n\nBisous, M.`,
    `Mon amour,\n\n    plus que douze jours. Ce n'est rien, douze jours, n'est-ce pas ?\n\nM.`,
  ],
};

/** Sheet faces for multi-sheet samples, in reading order (RU, with a little French). */
const SAMPLE_FACES = [
  SAMPLE_LETTER,
  `    А ещё — помнишь ту лавку с вареньем на углу? Её закрыли, и мне почему-то грустно, будто закрыли кусочек нашего лета.\n\n    Je garde le pot de confiture de cerises pour ton retour. Ne ris pas.`,
  `Лист второй, потому что первый кончился.\n\n    Вчера шёл через мост и считал фонари: ровно сорок два. Ты бы сказала, что это знак. Может, и знак.`,
  `    Ещё немного, и я опять начну писать на полях. Целую в нос.\n\nP.S. Le facteur m'a souri ce matin, il sait.`,
  `Третий лист — это уже роман, да?\n\n    Мама передаёт привет и спрашивает, ешь ли ты суп. Ешь, пожалуйста.`,
  `    Всё, заканчиваю, а то конверт не закроется.\n\nТвой Н.`,
  `Четвёртый. Обещаю, последний.\n\n    Просто хотелось ещё побыть с тобой на бумаге.`,
  `    Je t'embrasse fort, très fort.`,
];

/**
 * A deterministic stack of `n` sheets (1–4) for labs and visual QA: the backs of
 * sheets 1, 3 and 4 are written, sheet 2's back is left blank (a turned-off verso).
 * One sheet is SAMPLE_LETTER alone, front only: the letter the labs always showed.
 */
export function sampleSheets(n: number): SheetContent[] {
  return Array.from({ length: Math.max(1, Math.min(4, n)) }, (_, i) => {
    const twoSided = n > 1 && i !== 1;
    return {
      recto: { text: SAMPLE_FACES[i * 2], strokes: [] },
      verso: { text: twoSided ? SAMPLE_FACES[i * 2 + 1] : '', strokes: [] },
      twoSided,
    };
  });
}
