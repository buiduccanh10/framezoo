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

const SUBTITLE_EXT_RE = /\.(?:srt|vtt|sub|ass|ssa|idx|smi|txt)$/i;
const MEDIA_FILENAME_HINT_RE =
  /\b(?:1080p|720p|480p|2160p|4k|bluray|web-?dl|telesync|cam|x264|x265|hevc|aac\d?|dts)\b/i;

function isLikelyFilename(value: string): boolean {
  return SUBTITLE_EXT_RE.test(value) || MEDIA_FILENAME_HINT_RE.test(value);
}

const SUBTITLE_EXTS = new Set([
  "srt",
  "vtt",
  "sub",
  "ass",
  "ssa",
  "idx",
  "smi",
  "txt",
]);

function extractLanguageFromFilename(filename: string): string | null {
  // Extract trailing language code before extension, e.g. .es1.srt, .zh-tw.srt, .en.srt, -eh.a.es1.srt
  const match = filename.match(
    /[._-]([a-z]{2,3}(?:-[a-z]{2,4})?)(?:\d+)?\.(?:srt|vtt|sub|ass|ssa|idx|smi|txt)$/i,
  );
  if (match) {
    const candidate = match[1].toLowerCase();
    if (!SUBTITLE_EXTS.has(candidate)) return candidate;
  }
  // Trailing language code without extension, e.g. .zh-tw, .en, .es (only if filename does not have subtitle extension)
  if (!SUBTITLE_EXT_RE.test(filename)) {
    const endMatch = filename.match(
      /[._-]([a-z]{2,3}(?:-[a-z]{2,4})?)(?:\d+)?$/i,
    );
    if (endMatch) {
      const candidate = endMatch[1].toLowerCase();
      if (!SUBTITLE_EXTS.has(candidate)) return candidate;
    }
  }
  // Bracketed/parenthesized language tag, e.g. [es], (spa)
  const bracketMatch = filename.match(
    /[\[(]([a-z]{2,3}(?:-[a-z]{2,4})?)[\])]/i,
  );
  if (bracketMatch) {
    const candidate = bracketMatch[1].toLowerCase();
    if (!SUBTITLE_EXTS.has(candidate)) return candidate;
  }
  return null;
}

export function canonicalizeLanguageCode(value: string): string {
  let target = value;
  if (isLikelyFilename(value)) {
    const extracted = extractLanguageFromFilename(value);
    if (!extracted) return "unknown";
    target = extracted;
  }

  const resolved = labelToLanguageCode(target);
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
