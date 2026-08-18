import { describe, expect, it, vi } from "vitest";

const storageMock = vi.hoisted(() => {
  const map = new Map<string, string>();
  const mock = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, String(value)),
    removeItem: (key: string) => map.delete(key),
    clear: () => map.clear(),
    get length() {
      return map.size;
    },
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    _map: map,
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: mock,
    configurable: true,
    writable: true,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      value: mock,
      configurable: true,
      writable: true,
    });
  }
  return mock;
});

import i18n, { getInitialLanguage } from "@/setup/i18n";
import { changeAppLanguage, useLanguageStore } from "@/stores/language";

describe("Language initialization and sync", () => {
  it("extracts language from localStorage if present", () => {
    storageMock._map.set(
      "__MW::locale",
      JSON.stringify({
        state: { language: "vi" },
        version: 0,
      }),
    );
    expect(getInitialLanguage()).toBe("vi");
  });

  it("translates finishingSetup to Vietnamese when language is vi", () => {
    changeAppLanguage("vi");
    expect(i18n.t("screens.finishingSetup")).toBe("Đang hoàn tất thiết lập…");
  });

  it("updates i18n language automatically when useLanguageStore changes", () => {
    useLanguageStore.getState().setLanguage("vi");
    expect(i18n.t("screens.finishingSetup")).toBe("Đang hoàn tất thiết lập…");

    useLanguageStore.getState().setLanguage("en");
    expect(i18n.t("screens.finishingSetup")).toBe("Finishing setup…");
  });
});
