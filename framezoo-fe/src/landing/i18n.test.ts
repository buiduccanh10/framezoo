import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LANDING_LOCALES,
  LANDING_LOCALE_STORAGE_KEY,
  getInitialLandingLocale,
  getLandingCopy,
} from "./i18n";

const storageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    clear: () => {
      store = {};
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: storageMock,
  writable: true,
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("landing locale detection", () => {
  it("registers every generated locale with a complete landing catalog", () => {
    expect(LANDING_LOCALES.length).toBeGreaterThan(2);

    for (const locale of LANDING_LOCALES) {
      expect(getLandingCopy(locale.id).nav.features).toBeTruthy();
      expect(getLandingCopy(locale.id).download.download).toBeTruthy();
    }
  });

  it("uses a saved locale before the browser locale", () => {
    vi.stubGlobal("navigator", {
      language: "vi-VN",
      languages: ["vi-VN"],
    });
    window.localStorage.setItem(LANDING_LOCALE_STORAGE_KEY, "en");

    expect(getInitialLandingLocale()).toBe("en");
  });

  it("uses the first supported browser language", () => {
    vi.stubGlobal("navigator", {
      language: "zz-ZZ",
      languages: ["zz-ZZ", "vi-VN", "en-US"],
    });

    expect(getInitialLandingLocale()).toBe("vi");
  });

  it("falls back to English when the browser language is unsupported", () => {
    vi.stubGlobal("navigator", {
      language: "zz-ZZ",
      languages: ["zz-ZZ"],
    });

    expect(getInitialLandingLocale()).toBe("en");
  });

  it("maps Traditional Chinese browser tags to the Traditional Chinese catalog", () => {
    vi.stubGlobal("navigator", {
      language: "zh-TW",
      languages: ["zh-TW"],
    });

    expect(getInitialLandingLocale()).toBe("zh-Hant");
  });

  it("maps base language tags to the first supported regional catalog", () => {
    vi.stubGlobal("navigator", {
      language: "fi",
      languages: ["fi"],
    });

    expect(getInitialLandingLocale()).toBe("fi-FI");
  });
});
