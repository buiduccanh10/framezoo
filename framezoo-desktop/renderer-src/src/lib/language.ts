import { getTag } from "@sozialhelden/ietf-language-tags";
import { iso6393To1 } from "iso-639-3";

const languageAliases: Record<string, string> = {
  ar: "ar",
  arabic: "ar",
  bg: "bg",
  bulgarian: "bg",
  bn: "bn",
  bengali: "bn",
  cs: "cs",
  czech: "cs",
  da: "da",
  danish: "da",
  de: "de",
  german: "de",
  dutch: "nl",
  el: "el",
  greek: "el",
  en: "en",
  eng: "en",
  english: "en",
  es: "es",
  spa: "es",
  spanish: "es",
  "spanish latin america": "es-419",
  "spanish latin american": "es-419",
  "latin american spanish": "es-419",
  fa: "fa",
  farsi: "fa",
  persian: "fa",
  "farsi persian": "fa",
  fi: "fi",
  finnish: "fi",
  fr: "fr",
  fre: "fr",
  fra: "fr",
  french: "fr",
  he: "he",
  hebrew: "he",
  hi: "hi",
  hindi: "hi",
  hu: "hu",
  hungarian: "hu",
  id: "id",
  indonesian: "id",
  it: "it",
  ita: "it",
  italian: "it",
  ja: "ja",
  jpn: "ja",
  japanese: "ja",
  ko: "ko",
  kor: "ko",
  korean: "ko",
  ms: "ms",
  malay: "ms",
  nl: "nl",
  norwegian: "no",
  no: "no",
  pl: "pl",
  polish: "pl",
  portuguese: "pt",
  pt: "pt",
  "brazilian portuguese": "pt-br",
  "portuguese br": "pt-br",
  "portuguese brazil": "pt-br",
  pob: "pt-br",
  ru: "ru",
  rus: "ru",
  russian: "ru",
  sl: "sl",
  slovene: "sl",
  slovenian: "sl",
  sv: "sv",
  swedish: "sv",
  th: "th",
  thai: "th",
  tr: "tr",
  turkish: "tr",
  uk: "uk",
  ukrainian: "uk",
  vi: "vi",
  vie: "vi",
  vietnamese: "vi",
  zh: "zh",
  chinese: "zh",
  "bilingual chinese": "zh",
  "chinese bilingual": "zh",
  "chinese simplified": "zh-cn",
  "simplified chinese": "zh-cn",
  "chinese traditional": "zh-tw",
  "traditional chinese": "zh-tw",
};

function normalizeLanguageLookupLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .replace(/[()]+/g, " ")
    .replace(/\bbilingual\b/g, " ")
    .replace(/(?:[\s.-]+hi\d*)$/i, "")
    .replace(/\d+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLanguageCodeCandidate(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[()]+/g, "")
    .replace(/(?:[.-]+hi\d*)$/i, "")
    .replace(/\d+$/, "")
    .replace(/-+/g, "-")
    .trim();
}

export function labelToLanguageCode(label?: string | null): string | null {
  if (!label) return null;

  const normalizedLabel = normalizeLanguageLookupLabel(label);
  if (!normalizedLabel) return null;

  if (languageAliases[normalizedLabel]) return languageAliases[normalizedLabel];

  const normalizedCode = normalizeLanguageCodeCandidate(label);
  if (!normalizedCode) return null;

  const fromIso6393 = iso6393To1[normalizedCode];
  if (fromIso6393) return fromIso6393;

  const tag = getTag(normalizedCode, true);
  if (tag?.language?.Description?.[0]) {
    return tag.parts.langtag ?? normalizedCode;
  }

  return null;
}
