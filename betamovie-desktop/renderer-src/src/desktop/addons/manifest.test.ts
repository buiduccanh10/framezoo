import { describe, expect, it } from "vitest";

import { normalizeManifest, normalizeManifestUrl } from "./manifest";

describe("Stremio manifest", () => {
  it("normalizes the URL and derives the addon base URL", () => {
    expect(normalizeManifestUrl("https://example.com/manifest.json")).toBe(
      "https://example.com/manifest.json",
    );

    const addon = normalizeManifest("https://example.com/manifest.json", {
      id: "com.example.addon",
      version: "1.0.0",
      name: "Example",
      resources: ["stream"],
      types: ["movie"],
    });

    expect(addon.baseUrl).toBe("https://example.com/");
    expect(addon.enabled).toBe(true);
  });

  it("rejects manifests without a stream resource", () => {
    expect(() =>
      normalizeManifest("https://example.com/manifest.json", {
        id: "com.example.addon",
        version: "1.0.0",
        name: "Example",
        resources: ["catalog"],
      }),
    ).toThrow("stream resource");
  });
});
