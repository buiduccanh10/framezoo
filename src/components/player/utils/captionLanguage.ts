import { labelToLanguageCode } from "@p-stream/providers";

import { CaptionListItem } from "@/stores/player/slices/source";

const LANGUAGE_ALIASES: Record<string, string[]> = {
  en: ["eng", "english"],
  vi: ["vie", "vietnamese"],
};

function sanitizeLanguageLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s*hi\d*$/i, "")
    .replace(/\d+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeLanguageCode(value: string): string {
  const normalized = sanitizeLanguageLabel(value);
  const base = normalized.split("-")[0];

  for (const [canonical, aliases] of Object.entries(LANGUAGE_ALIASES)) {
    if (base === canonical || aliases.includes(base)) {
      return canonical;
    }
  }

  return base || "unknown";
}

export function getLanguageCandidates(language: string): string[] {
  const canonical = canonicalizeLanguageCode(language);
  const aliases = LANGUAGE_ALIASES[canonical] ?? [];

  return Array.from(new Set([canonical, ...aliases]));
}

export function isLanguageMatch(a: string, b: string): boolean {
  const aCandidates = new Set(getLanguageCandidates(a));
  const bCandidates = new Set(getLanguageCandidates(b));

  for (const candidate of aCandidates) {
    if (bCandidates.has(candidate)) return true;
  }

  return false;
}

export function getCaptionLanguageGroupKey(
  caption: Pick<CaptionListItem, "language" | "display">,
): string {
  const fromDisplay = caption.display
    ? labelToLanguageCode(sanitizeLanguageLabel(caption.display))
    : null;

  if (fromDisplay) {
    return canonicalizeLanguageCode(fromDisplay);
  }

  if (caption.language) {
    const fromLanguageLabel = labelToLanguageCode(
      sanitizeLanguageLabel(caption.language),
    );

    return canonicalizeLanguageCode(fromLanguageLabel || caption.language);
  }

  return "unknown";
}
