import { labelToLanguageCode } from "@/lib/language";
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
    .replace(/(?:[\s.-]+hi\d*)$/i, "")
    .replace(/\d+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeLanguageCode(value: string): string {
  const resolved = labelToLanguageCode(value);
  if (!resolved) return "unknown";

  const normalized = sanitizeLanguageLabel(resolved);
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

  const canonical = canonicalizeLanguageCode(value);
  return canonical === "unknown" ? null : canonical;
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

export function inferCaptionLanguageFromItems(
  captions: Array<Pick<CaptionListItem, "language" | "display">>,
): string | null {
  const candidates = Array.from(new Set<string>());

  captions.forEach((caption) => {
    const fromLanguage = normalizeCaptionLanguage(caption.language);
    if (fromLanguage) {
      candidates.push(fromLanguage);
    }

    const fromDisplay = normalizeCaptionLanguage(caption.display);
    if (fromDisplay) {
      candidates.push(fromDisplay);
    }
  });

  const uniqueCandidates = Array.from(new Set(candidates));

  if (uniqueCandidates.length !== 1) return null;

  return uniqueCandidates[0];
}
