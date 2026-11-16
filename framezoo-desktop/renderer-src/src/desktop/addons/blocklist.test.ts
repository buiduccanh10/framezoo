import { describe, expect, it } from "vitest";

import {
  extractHostname,
  isDomainInBlocklist,
  isMediaBlocked,
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

  it("matches tmdb ids in bare or typed forms", () => {
    expect(isMediaBlocked("550", "movie", ["movie:550"])).toBe(true);
    expect(isMediaBlocked("1399", "show", ["tv:1399"])).toBe(true);
    expect(isMediaBlocked("1399", "show", ["550"])).toBe(false);
  });
});
