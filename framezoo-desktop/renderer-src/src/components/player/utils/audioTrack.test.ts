import { describe, expect, it } from "vitest";

import {
  findDefaultEnglishTrack,
  isCommentaryTrack,
  isEnglishAudioTrack,
  resolveDefaultAudioTrack,
} from "./audioTrack";

describe("audioTrack utilities", () => {
  describe("isEnglishAudioTrack", () => {
    it("identifies tracks by language code", () => {
      expect(isEnglishAudioTrack({ language: "en" })).toBe(true);
      expect(isEnglishAudioTrack({ language: "eng" })).toBe(true);
      expect(isEnglishAudioTrack({ language: "en-US" })).toBe(true);
      expect(isEnglishAudioTrack({ language: "en_GB" })).toBe(true);
    });

    it("identifies tracks by label/title", () => {
      expect(
        isEnglishAudioTrack({ language: "unknown", label: "English" }),
      ).toBe(true);
      expect(
        isEnglishAudioTrack({
          language: "unknown",
          label: "English [5.1 Surround]",
        }),
      ).toBe(true);
      expect(
        isEnglishAudioTrack({ language: "und", label: "Audio (eng)" }),
      ).toBe(true);
      expect(isEnglishAudioTrack({ language: "", label: "english" })).toBe(
        true,
      );
    });

    it("rejects non-English tracks", () => {
      expect(isEnglishAudioTrack({ language: "ru", label: "Russian" })).toBe(
        false,
      );
      expect(
        isEnglishAudioTrack({ language: "rus", label: "Russian [5.1]" }),
      ).toBe(false);
      expect(isEnglishAudioTrack({ language: "uk", label: "Ukrainian" })).toBe(
        false,
      );
      expect(isEnglishAudioTrack({ language: "ja", label: "Japanese" })).toBe(
        false,
      );
      expect(isEnglishAudioTrack({ language: "vi", label: "Vietnamese" })).toBe(
        false,
      );
      expect(isEnglishAudioTrack(null)).toBe(false);
      expect(isEnglishAudioTrack(undefined)).toBe(false);
    });
  });

  describe("isCommentaryTrack", () => {
    it("identifies commentary or descriptive tracks", () => {
      expect(
        isCommentaryTrack({ label: "English (Director's Commentary)" }),
      ).toBe(true);
      expect(isCommentaryTrack({ label: "English Audio Description" })).toBe(
        true,
      );
      expect(isCommentaryTrack({ label: "English SDH" })).toBe(true);
      expect(isCommentaryTrack({ label: "English [Stereo]" })).toBe(false);
    });
  });

  describe("findDefaultEnglishTrack", () => {
    it("returns the first English track when available", () => {
      const tracks = [
        { id: "1", language: "ru", label: "Russian" },
        { id: "2", language: "uk", label: "Ukrainian" },
        { id: "3", language: "en", label: "English" },
      ];
      expect(findDefaultEnglishTrack(tracks)).toEqual(tracks[2]);
    });

    it("prefers non-commentary English track over commentary track", () => {
      const tracks = [
        { id: "1", language: "en", label: "English (Director Commentary)" },
        { id: "2", language: "en", label: "English 5.1" },
      ];
      expect(findDefaultEnglishTrack(tracks)).toEqual(tracks[1]);
    });

    it("returns undefined if no English track exists", () => {
      const tracks = [
        { id: "1", language: "ru", label: "Russian" },
        { id: "2", language: "uk", label: "Ukrainian" },
      ];
      expect(findDefaultEnglishTrack(tracks)).toBeUndefined();
    });
  });

  describe("resolveDefaultAudioTrack", () => {
    it("selects English track instead of first index", () => {
      const tracks = [
        { id: "1", language: "ru", label: "Russian" },
        { id: "2", language: "uk", label: "Ukrainian" },
        { id: "3", language: "en", label: "English" },
      ];
      const result = resolveDefaultAudioTrack(tracks, tracks[0]);
      expect(result).toEqual(tracks[2]);
    });

    it("keeps current track if it is already English", () => {
      const tracks = [
        { id: "1", language: "en", label: "English" },
        { id: "2", language: "ru", label: "Russian" },
      ];
      const result = resolveDefaultAudioTrack(tracks, tracks[0]);
      expect(result).toEqual(tracks[0]);
    });

    it("falls back to current track or first track if no English track exists", () => {
      const tracks = [
        { id: "1", language: "ru", label: "Russian" },
        { id: "2", language: "uk", label: "Ukrainian" },
      ];
      const result = resolveDefaultAudioTrack(tracks, tracks[0]);
      expect(result).toEqual(tracks[0]);
    });
  });
});
