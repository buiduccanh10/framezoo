import { labelToLanguageCode } from "@/lib/providers";
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

export function canonicalizeLanguageCode(value: string): string {
  const normalized = sanitizeLanguageLabel(value);
  const base = normalized.split("-")[0];

  for (const [canonical, aliases] of Object.entries(LANGUAGE_ALIASES)) {
    if (base === canonical || aliases.includes(base)) {
      return canonical;
    }
  }

  return base || "unknown";
}

export function normalizeCaptionLanguage(value?: string | null): string | null {
  if (!value) return null;

  const sanitized = sanitizeLanguageLabel(value);
  if (!sanitized) return null;

  const fromLabel = labelToLanguageCode(sanitized);

  return canonicalizeLanguageCode(fromLabel || sanitized);
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
  if (caption.language) {
    const normalizedLanguage = normalizeCaptionLanguage(caption.language);

    if (normalizedLanguage && normalizedLanguage !== "unknown") {
      return normalizedLanguage;
    }
  }

  if (caption.display) {
    const normalizedDisplay = normalizeCaptionLanguage(caption.display);

    if (normalizedDisplay) {
      return normalizedDisplay;
    }
  }

  return "unknown";
}
