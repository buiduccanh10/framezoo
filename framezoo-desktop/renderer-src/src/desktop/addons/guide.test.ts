import { afterEach, describe, expect, it } from "vitest";

import { getAddonGuideUrl } from "./guide";

afterEach(() => {
  window.__CONFIG__ = undefined;
});

describe("addon guide URL", () => {
  it("uses the local landing guide by default", () => {
    expect(getAddonGuideUrl()).toBe("http://localhost:5173/#addon-guide");
  });

  it("accepts a configured HTTP(S) guide URL", () => {
    window.__CONFIG__ = {
      VITE_ADDON_GUIDE_URL: "https://framezoo.example/addons#addon-guide",
    };

    expect(getAddonGuideUrl()).toBe(
      "https://framezoo.example/addons#addon-guide",
    );
  });

  it("falls back when the configured URL is unsafe or invalid", () => {
    window.__CONFIG__ = {
      VITE_ADDON_GUIDE_URL: "javascript:alert(1)",
    };

    expect(getAddonGuideUrl()).toBe("http://localhost:5173/#addon-guide");
  });
});
