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

export function resolveDefaultAudioTrack<T extends AudioTrack>(
  tracks: T[],
  currentTrack: T | null,
): T | null {
  if (tracks.length === 0) return null;
  if (currentTrack && isEnglishAudioTrack(currentTrack)) {
    return currentTrack;
  }
  const defaultEnglishTrack = findDefaultEnglishTrack(tracks);
  if (defaultEnglishTrack) {
    return defaultEnglishTrack;
  }
  return currentTrack ?? tracks[0] ?? null;
}
