const LANGUAGE_NAME_TO_CODE: Record<string, string> = {
  english: 'en',
  vietnamese: 'vi',
  french: 'fr',
  german: 'de',
  spanish: 'es',
  'spanish (la)': 'es',
  'spanish (latin america)': 'es',
  spanish_latin_america: 'es',
  portuguese: 'pt',
  'portuguese (br)': 'pt-br',
  'portuguese (brazil)': 'pt-br',
  brazilian_portuguese: 'pt-br',
  italian: 'it',
  japanese: 'ja',
  korean: 'ko',
  chinese: 'zh',
  'chinese (simplified)': 'zh-cn',
  'chinese (traditional)': 'zh-tw',
  chinese_simplified: 'zh-cn',
  chinese_traditional: 'zh-tw',
  thai: 'th',
  indonesian: 'id',
  russian: 'ru',
  dutch: 'nl',
  polish: 'pl',
  turkish: 'tr',
  swedish: 'sv',
  danish: 'da',
  finnish: 'fi',
  norwegian: 'no',
  arabic: 'ar',
  hindi: 'hi',
  bengali: 'bn',
  greek: 'el',
  hebrew: 'he',
  hungarian: 'hu',
  czech: 'cs',
  romanian: 'ro',
  ukrainian: 'uk',
  farsi: 'fa',
  persian: 'fa',
  farsi_persian: 'fa',
  malay: 'ms',
};

const COMMON_ISO_639_2_TO_1: Record<string, string> = {
  eng: 'en',
  vie: 'vi',
  fre: 'fr',
  fra: 'fr',
  ger: 'de',
  deu: 'de',
  spa: 'es',
  por: 'pt',
  pob: 'pt-br',
  ita: 'it',
  jpn: 'ja',
  kor: 'ko',
  zho: 'zh',
  chi: 'zh',
  tha: 'th',
  ind: 'id',
  rus: 'ru',
  dut: 'nl',
  nld: 'nl',
  pol: 'pl',
  tur: 'tr',
  swe: 'sv',
  dan: 'da',
  fin: 'fi',
  nor: 'no',
  ara: 'ar',
  hin: 'hi',
  ben: 'bn',
  ell: 'el',
  gre: 'el',
  heb: 'he',
  hun: 'hu',
  ces: 'cs',
  cze: 'cs',
  ron: 'ro',
  rum: 'ro',
  ukr: 'uk',
  fas: 'fa',
  per: 'fa',
  msa: 'ms',
  may: 'ms',
};

export function normalizeLanguageCode(input?: string | null): string {
  if (!input) return 'unknown';
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return 'unknown';

  if (LANGUAGE_NAME_TO_CODE[trimmed]) {
    return LANGUAGE_NAME_TO_CODE[trimmed];
  }

  if (COMMON_ISO_639_2_TO_1[trimmed]) {
    return COMMON_ISO_639_2_TO_1[trimmed];
  }

  // If input is e.g. "en-us" or "pt-br"
  if (/^[a-z]{2}(-[a-z0-9]{2,4})?$/.test(trimmed)) {
    return trimmed;
  }

  return trimmed;
}
