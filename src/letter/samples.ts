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
