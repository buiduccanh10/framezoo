import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { locales } from "@/assets/languages";
import { getLocaleInfo } from "@/utils/language";

// Languages
const langCodes = Object.keys(locales);
const resources = Object.fromEntries(
  Object.entries(locales).map((entry) => [entry[0], { translation: entry[1] }]),
);

export function getInitialLanguage(): string {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem("__MW::locale");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed?.state?.language &&
          typeof parsed.state.language === "string"
        ) {
          return parsed.state.language;
        }
      }
    }
  } catch {
    // Ignore localStorage read/parse errors and fallback
  }
  return typeof navigator !== "undefined" && navigator.language
    ? navigator.language.split("-")[0]
    : "en";
}

const initialLang = getInitialLanguage();
const initialLocale = getLocaleInfo(initialLang);

i18n.use(initReactI18next).init({
  lng: initialLocale?.code ?? initialLang,
  fallbackLng: "en",
  resources,
  interpolation: {
    escapeValue: false, // not needed for react as it escapes by default
  },
});

export const appLanguageOptions = langCodes.map((lang) => {
  const langObj = getLocaleInfo(lang);
  if (!langObj)
    throw new Error(`Language with code ${lang} cannot be found in database`);
  return langObj;
});

export default i18n;
