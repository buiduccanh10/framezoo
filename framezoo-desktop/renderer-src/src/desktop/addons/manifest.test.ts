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

  it("preserves addon metadata and allows resource-specific manifests", () => {
    const addon = normalizeManifest(
      "https://example.com/addons/example/manifest.json",
      {
        id: " com.example.addon ",
        version: " 1.0.0 ",
        name: " Example ",
        description: "Catalog-only addon",
        logo: "assets/logo.svg",
        background: "/assets/background.jpg",
        resources: ["catalog"],
        types: ["movie"],
        catalogs: [{ type: "movie", id: "top", name: "Top" }],
        behaviorHints: { configurable: true },
      },
    );

    expect(addon.manifest).toMatchObject({
      id: "com.example.addon",
      version: "1.0.0",
      name: "Example",
      description: "Catalog-only addon",
      logo: "https://example.com/addons/example/assets/logo.svg",
      background: "https://example.com/assets/background.jpg",
      resources: ["catalog"],
      types: ["movie"],
      catalogs: [{ type: "movie", id: "top", name: "Top" }],
      behaviorHints: { configurable: true },
    });
  });

  it("rejects manifests without non-empty required metadata", () => {
    expect(() =>
      normalizeManifest("https://example.com/manifest.json", {
        id: "com.example.addon",
        version: "1.0.0",
        name: " ",
      }),
    ).toThrow("name");
  });

  it("drops unsupported asset protocols so the UI can use its fallback", () => {
    const addon = normalizeManifest("https://example.com/manifest.json", {
      id: "com.example.addon",
      version: "1.0.0",
      name: "Example",
      logo: "javascript:alert(1)",
      background: "data:text/plain,unsafe",
    });

    expect(addon.manifest.logo).toBeUndefined();
    expect(addon.manifest.background).toBeUndefined();
  });
});
