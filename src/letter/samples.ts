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
