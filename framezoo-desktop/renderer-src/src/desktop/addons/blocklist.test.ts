import { describe, expect, it } from "vitest";

import {
  extractHostname,
  isAddonMediaBlocked,
  isDomainInBlocklist,
  isImdbBlocked,
  isInfohashBlocked,
  isMediaBlocked,
  isSubtitleIdBlocked,
} from "./blocklist";

describe("desktop compliance blocklist helpers", () => {
  it("extracts hostnames and matches exact and subdomain blocks without partial false positives", () => {
    expect(
      extractHostname("https://CDN.BlockedAddon.org:8443/manifest.json"),
    ).toBe("cdn.blockedaddon.org");
    expect(
      isDomainInBlocklist("https://sub.blockedaddon.org/manifest.json", [
        "blockedaddon.org",
      ]),
    ).toBe(true);
    expect(
      isDomainInBlocklist("https://notblockedaddon.org/manifest.json", [
        "blockedaddon.org",
      ]),
    ).toBe(false);
  });

  it("matches tmdb, imdb, infohash, and subtitle ids across forms", () => {
    expect(isMediaBlocked("550", "movie", ["movie:550"])).toBe(true);
    expect(isMediaBlocked("1399", "show", ["tv:1399"])).toBe(true);
    expect(isMediaBlocked("1399", "show", ["550"])).toBe(false);

    expect(isImdbBlocked("tt0137523:1:2", ["tt0137523"])).toBe(true);
    expect(isImdbBlocked("tt0137524", ["tt0137523"])).toBe(false);

    expect(
      isAddonMediaBlocked("tt0137523:1:2", "series", {
        tmdbIds: [],
        imdbIds: ["tt0137523"],
      }),
    ).toBe(true);
    expect(
      isAddonMediaBlocked("tmdb:1399", "series", {
        tmdbIds: ["tv:1399"],
        imdbIds: [],
      }),
    ).toBe(true);

    expect(
      isInfohashBlocked("ABCDEF1234567890ABCDEF1234567890ABCDEF12", [
        "abcdef1234567890abcdef1234567890abcdef12",
      ]),
    ).toBe(true);
    expect(
      isInfohashBlocked(
        null,
        ["abcdef1234567890abcdef1234567890abcdef12"],
        "magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12",
      ),
    ).toBe(true);

    expect(isSubtitleIdBlocked("subsource:99123:vi", ["subsource:99123"])).toBe(
      true,
    );
    expect(isSubtitleIdBlocked("opensubs:555", ["opensubs:555:en"])).toBe(true);
    expect(isSubtitleIdBlocked("wyzie:111:en", ["subsource:111"])).toBe(false);
  });
});
