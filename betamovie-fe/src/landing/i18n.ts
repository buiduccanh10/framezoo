import localeManifest from "./locale-manifest.json";
import enCopy from "./locales/en.json";

export const LANDING_LOCALE_STORAGE_KEY = "alphaflix-landing-locale";

export type LandingLocaleOption = (typeof localeManifest)[number];
export const LANDING_LOCALES = localeManifest as readonly LandingLocaleOption[];

export type LandingLocale = (typeof LANDING_LOCALES)[number]["id"];
export type LandingCopy = typeof enCopy;

const localeModules = import.meta.glob("./locales/*.json", {
  eager: true,
  import: "default",
}) as Record<string, LandingCopy>;

const copy: Record<string, LandingCopy> = Object.fromEntries(
  LANDING_LOCALES.map((locale) => [
    locale.id,
    localeModules[`./locales/${locale.file}.json`] ?? enCopy,
  ]),
);

const BROWSER_LOCALE_ALIASES: Record<string, string> = {
  "zh-hans": "zh",
  "zh-hk": "zh-Hant",
  "zh-tw": "zh-Hant",
};

function getSupportedLocale(language: string | undefined) {
  const normalized = language?.toLowerCase().replace("_", "-");
  if (!normalized) return null;

  const aliasedLocale = BROWSER_LOCALE_ALIASES[normalized];
  if (aliasedLocale) return aliasedLocale;

  const exactLocale = LANDING_LOCALES.find(
    (locale) => locale.id.toLowerCase() === normalized,
  );
  if (exactLocale) return exactLocale.id;

  const languageCode = normalized.split("-")[0];
  return (
    LANDING_LOCALES.find((locale) => locale.id === languageCode)?.id ??
    LANDING_LOCALES.find((locale) => locale.id.startsWith(`${languageCode}-`))
      ?.id ??
    null
  );
}

export function getLandingCopy(locale: LandingLocale) {
  return copy[locale] ?? enCopy;
}

export function getLandingLocaleOption(locale: LandingLocale) {
  return LANDING_LOCALES.find((option) => option.id === locale);
}

export function getInitialLandingLocale() {
  if (typeof window === "undefined") return "en" as LandingLocale;

  try {
    const storedLocale = getSupportedLocale(
      window.localStorage.getItem(LANDING_LOCALE_STORAGE_KEY) ?? undefined,
    );
    if (storedLocale) return storedLocale;
  } catch {
    // Storage can be unavailable in private browsing contexts.
  }

  const languages =
    navigator.languages?.length > 0
      ? navigator.languages
      : [navigator.language];

  for (const language of languages) {
    const supportedLocale = getSupportedLocale(language);
    if (supportedLocale) return supportedLocale;
  }

  return "en";
}
