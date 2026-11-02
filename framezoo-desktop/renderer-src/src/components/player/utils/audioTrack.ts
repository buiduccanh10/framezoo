import { iso6393To1 } from "iso-639-3";

import { labelToLanguageCode } from "@/lib/language";
import { AudioTrack } from "@/stores/player/slices/source";

import { canonicalizeLanguageCode } from "./captionLanguage";

export function isEnglishAudioTrack(
  track?: { language?: string; label?: string } | null,
): boolean {
  if (!track) return false;

  const lang = (track.language ?? "").trim().toLowerCase();
  if (lang === "en" || lang === "eng") return true;
  if (lang.startsWith("en-") || lang.startsWith("en_")) return true;
  if (iso6393To1[lang] === "en") return true;

  if (track.language && canonicalizeLanguageCode(track.language) === "en") {
    return true;
  }
  if (track.label && canonicalizeLanguageCode(track.label) === "en") {
    return true;
  }

  const resolvedCode =
    labelToLanguageCode(track.language) ?? labelToLanguageCode(track.label);
  if (
    resolvedCode &&
    (resolvedCode === "en" ||
      resolvedCode.startsWith("en-") ||
      resolvedCode.startsWith("en_"))
  ) {
    return true;
  }

  const label = (track.label ?? "").trim().toLowerCase();
  if (/\b(en|eng|english)\b/i.test(label)) return true;

  return false;
}

export function isCommentaryTrack(track?: { label?: string } | null): boolean {
  if (!track?.label) return false;
  const label = track.label.toLowerCase();
  return /\b(commentary|description|descriptive|sdh)\b/i.test(label);
}

export function findDefaultEnglishTrack<
  T extends { language?: string; label?: string },
>(tracks: T[]): T | undefined {
  const englishTracks = tracks.filter((t) => isEnglishAudioTrack(t));
  if (englishTracks.length === 0) return undefined;
  const nonCommentary = englishTracks.find((t) => !isCommentaryTrack(t));
  return nonCommentary ?? englishTracks[0];
}

export function findDefaultLanguageTrack<
  T extends { language?: string; label?: string },
>(tracks: T[], language?: string | null): T | undefined {
  if (!language) return undefined;

  const targetLanguage = canonicalizeLanguageCode(language);
  if (targetLanguage === "unknown") return undefined;

  const matchingTracks = tracks.filter((track) =>
    [track.language, track.label].some(
      (value) =>
        typeof value === "string" &&
        canonicalizeLanguageCode(value) === targetLanguage,
    ),
  );
  if (matchingTracks.length === 0) return undefined;

  return (
    matchingTracks.find((track) => !isCommentaryTrack(track)) ??
    matchingTracks[0]
  );
}

export function resolveDefaultAudioTrack<T extends AudioTrack>(
  tracks: T[],
  currentTrack: T | null,
  preferredLanguage?: string | null,
): T | null {
  if (tracks.length === 0) return null;

  const preferredTrack = findDefaultLanguageTrack(tracks, preferredLanguage);
  if (preferredTrack) return preferredTrack;

  if (currentTrack && isEnglishAudioTrack(currentTrack)) {
    return currentTrack;
  }
  const defaultEnglishTrack = findDefaultEnglishTrack(tracks);
  if (defaultEnglishTrack) {
    return defaultEnglishTrack;
  }
  return currentTrack ?? tracks[0] ?? null;
}
