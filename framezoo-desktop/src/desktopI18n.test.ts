import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getLocale: vi.fn(() => "en-US"),
  },
}));

import { app } from "electron";
import {
  getDesktopLocale,
  resolveLocale,
  setDesktopLocale,
  tDesktop,
} from "./desktopI18n";

describe("desktopI18n", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDesktopLocale("");
  });

  it("detects system locale by default", () => {
    vi.mocked(app.getLocale).mockReturnValueOnce("vi-VN");
    expect(getDesktopLocale()).toBe("vi");
  });

  it("resolves locales correctly including regional variants", () => {
    expect(resolveLocale("vi")).toBe("vi");
    expect(resolveLocale("vi-VN")).toBe("vi");
    expect(resolveLocale("pt-BR")).toBe("pt-BR");
    expect(resolveLocale("zh-Hant")).toBe("zh-Hant");
    expect(resolveLocale("unknown-locale")).toBe("en");
  });

  it("allows setting locale explicitly", () => {
    setDesktopLocale("vi");
    expect(getDesktopLocale()).toBe("vi");
  });

  it("translates key in English", () => {
    setDesktopLocale("en");
    const text = tDesktop("update.upToDateMessage", { version: "2.1.9" });
    expect(text).toBe("You are already on the latest desktop version (v2.1.9).");
  });

  it("translates key in Vietnamese", () => {
    setDesktopLocale("vi");
    const text = tDesktop("update.upToDateMessage", { version: "2.1.9" });
    expect(text).toBe("Bạn đang sử dụng phiên bản mới nhất (v2.1.9).");
  });

  it("translates key in Spanish", () => {
    setDesktopLocale("es");
    const text = tDesktop("update.upToDateMessage", { version: "2.1.9" });
    expect(text).toBe("Ya tienes la versión de escritorio más reciente (v2.1.9).");
  });

  it("supports canonical dot-notation keys directly", () => {
    setDesktopLocale("vi");
    const text = tDesktop("navigation.banner.appUpdate.upToDate", { version: "2.1.9" });
    expect(text).toBe("Bạn đang sử dụng phiên bản mới nhất (v2.1.9).");
  });

  it("falls back to English when locale does not have the key or is unsupported", () => {
    setDesktopLocale("unknown-lang");
    const text = tDesktop("update.updateFailedTitle");
    expect(text).toBe("Desktop update failed");
  });
});
