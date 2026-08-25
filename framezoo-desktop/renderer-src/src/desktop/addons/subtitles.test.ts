import { describe, expect, it, vi } from "vitest";

import {
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
      id: "addon:com.example.subs:0:https://example.com/sub.vtt",
      language: "vi",
      url: "https://example.com/sub.vtt",
      type: "vtt",
      needsProxy: false,
      opensubtitles: true,
      display: "Vietnamese",
      source: "wyzie",
      isHearingImpaired: true,
      encoding: "utf-8",
    });
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
});
