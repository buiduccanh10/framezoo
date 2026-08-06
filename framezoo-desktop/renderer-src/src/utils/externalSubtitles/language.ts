import { iso6393To1 } from "iso-639-3";

export function normalizeExternalSubtitleLanguage(
  language: string | null | undefined,
): string | undefined {
  const normalizedValue = language?.trim().toLowerCase();
  if (!normalizedValue) return undefined;

  let normalized = normalizedValue.split("-")[0];
  if (normalized && normalized.length === 3) {
    normalized =
      iso6393To1[normalized as keyof typeof iso6393To1] || normalized;
  }
  return normalized;
}

export function getExternalSubtitleLanguageKey(
  lastSelectedLanguage: string | null | undefined,
  appLanguage: string | null | undefined,
): string {
  return Array.from(
    new Set(
      [lastSelectedLanguage, appLanguage]
        .map(normalizeExternalSubtitleLanguage)
        .filter((language): language is string => Boolean(language)),
    ),
  )
    .sort()
    .join(",");
}
