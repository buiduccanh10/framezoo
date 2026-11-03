import { describe, expect, it, vi } from "vitest";

import { getSubtitleSourceBadgeClass } from "@/components/player/atoms/settings/CaptionsView";

import {
  inferSubtitleFormat,
  loadAddonSubtitles,
  loadAllAddonSubtitles,
  normalizeAddonSubtitle,
} from "./subtitles";
import type { InstalledAddon, StremioSubtitle } from "./types";

const fetchAddonJsonMock = vi.hoisted(() => vi.fn());

vi.mock("./client", () => ({
  fetchAddonJson: fetchAddonJsonMock.mockImplementation(async (url: string) => {
    if (url.includes("failing")) {
      throw new Error("Network error");
    }
    return {
      subtitles: [
        {
          id: "sub-1",
          url: "https://example.com/sub1.srt",
          lang: "eng",
          label: "English",
          source: "opensubs",
        },
      ],
    };
  }),
}));

describe("addon subtitles", () => {
  const addon: InstalledAddon = {
    manifestUrl: "https://example.com/manifest.json",
    baseUrl: "https://example.com/",
    manifest: {
      id: "com.example.subs",
      version: "1.0.0",
      name: "Example Subs",
      resources: ["subtitles"],
      types: ["movie", "series"],
      catalogs: [],
    },
    enabled: true,
    addedAt: 0,
  };

  it("adds a cache-busting request for forced subtitle refreshes", async () => {
    await loadAddonSubtitles(addon, "series", "tt1234567:1:2", {
      forceRefresh: true,
    });

    expect(fetchAddonJsonMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /subtitles\/series\/tt1234567%3A1%3A2\.json\?reload=\d+/,
      ),
      expect.objectContaining({
        cacheBust: expect.any(String),
      }),
    );
  });

  it("normalizes stremio subtitle correctly", () => {
    const raw: StremioSubtitle = {
      id: "sub-1",
      url: "https://example.com/sub.vtt",
      lang: "vi",
      label: "Vietnamese",
      source: "wyzie",
      type: "vtt",
      isHearingImpaired: true,
      encoding: "utf-8",
    };

    const normalized = normalizeAddonSubtitle(addon, raw, 0);
    expect(normalized).toEqual({
      id: "addon:com.example.subs:vi:https://example.com/sub.vtt",
      language: "vi",
      url: "https://example.com/sub.vtt",
      type: "vtt",
      needsProxy: false,
      opensubtitles: true,
      display: "Vietnamese",
      media: undefined,
      source: "wyzie",
      isHearingImpaired: true,
      encoding: "utf-8",
    });
  });

  it("extracts release title from id when label is missing (SubSource format)", () => {
    const raw: StremioSubtitle = {
      id: "Inception.2010.1080p.BluRay.DD+5.1.x264-playHD_1",
      url: "https://subsource.strem.top/subtitle/tt1375666/10195707.srt",
      lang: "vie",
    };

    const normalized = normalizeAddonSubtitle(addon, raw, 0);
    expect(normalized?.display).toBe(
      "Inception.2010.1080p.BluRay.DD+5.1.x264-playHD",
    );
    expect(normalized?.media).toBe(
      "Inception.2010.1080p.BluRay.DD+5.1.x264-playHD",
    );
  });

  it("extracts release title from id when label is generic language name", () => {
    const raw: StremioSubtitle = {
      id: "Game.of.Thrones.S01E01.Winter.Is.Coming.1080p.BluRay_9",
      url: "https://subsource.strem.top/subtitle/tt0944947/1588233.srt",
      lang: "vi",
      label: "Tiếng Việt",
    };

    const normalized = normalizeAddonSubtitle(addon, raw, 0);
    expect(normalized?.display).toBe(
      "Game.of.Thrones.S01E01.Winter.Is.Coming.1080p.BluRay",
    );
  });

  it("falls back to label when id is purely numeric", () => {
    const raw: StremioSubtitle = {
      id: "10195707",
      url: "https://example.com/10195707.srt",
      lang: "vie",
      label: "Vietnamese",
    };

    const normalized = normalizeAddonSubtitle(addon, raw, 0);
    expect(normalized?.display).toBe("Vietnamese");
  });

  it("loads subtitles across addons and reports onProgress", async () => {
    const updates: any[] = [];
    const failingAddon: InstalledAddon = {
      ...addon,
      manifestUrl: "https://failing.example.com/manifest.json",
      baseUrl: "https://failing.example.com/",
      manifest: {
        ...addon.manifest,
        id: "com.example.failing",
        name: "Failing Subs",
      },
    };

    const result = await loadAllAddonSubtitles(
      [addon, failingAddon],
      "movie",
      "tt1234567",
      (update) => {
        updates.push(update);
      },
    );

    expect(result.captions).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates[0]).toEqual({
      captions: [],
      completed: 0,
      total: 2,
    });
  });

  describe("inferSubtitleFormat", () => {
    it("respects explicit type", () => {
      expect(inferSubtitleFormat("vtt")).toBe("vtt");
      expect(inferSubtitleFormat(".srt")).toBe("srt");
    });

    it("infers from URL extension", () => {
      expect(
        inferSubtitleFormat(
          undefined,
          "https://subsource.strem.top/subtitle/tt1375666/10195707.srt",
        ),
      ).toBe("srt");
      expect(
        inferSubtitleFormat(
          undefined,
          "https://example.com/subs/vietnamese.vtt?token=123",
        ),
      ).toBe("vtt");
    });

    it("infers from query params or id", () => {
      expect(
        inferSubtitleFormat(
          undefined,
          "https://example.com/download?format=ass",
        ),
      ).toBe("ass");
      expect(
        inferSubtitleFormat(undefined, undefined, "movie.sub.vtt"),
      ).toBe("vtt");
    });

    it("defaults to srt when format cannot be determined", () => {
      expect(
        inferSubtitleFormat(
          undefined,
          "https://example.com/download/12345",
        ),
      ).toBe("srt");
    });
  });

  describe("getSubtitleSourceBadgeClass", () => {
    it("assigns cyan to subsource", () => {
      expect(getSubtitleSourceBadgeClass("subsource")).toBe("bg-cyan-600");
      expect(getSubtitleSourceBadgeClass("SubSource Subtitles")).toBe(
        "bg-cyan-600",
      );
    });

    it("assigns blue to wyzie", () => {
      expect(getSubtitleSourceBadgeClass("wyzie charlie")).toBe("bg-blue-600");
    });

    it("assigns orange to opensubs", () => {
      expect(getSubtitleSourceBadgeClass("opensubs")).toBe("bg-orange-500");
      expect(getSubtitleSourceBadgeClass("OpenSubtitles v3")).toBe(
        "bg-orange-500",
      );
    });

    it("assigns amber to subdl", () => {
      expect(getSubtitleSourceBadgeClass("SubDL Subtitles")).toBe("bg-amber-600");
    });

    it("assigns stable deterministic palette color for custom/unknown addons", () => {
      const color1 = getSubtitleSourceBadgeClass("Random Addon Subtitles");
      const color2 = getSubtitleSourceBadgeClass("Random Addon Subtitles");
      expect(color1).toBe(color2);
      expect(color1).toMatch(/^bg-[a-z]+-600$/);
    });
  });
});
