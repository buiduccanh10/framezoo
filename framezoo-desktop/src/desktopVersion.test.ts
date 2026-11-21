import { describe, expect, it } from "vitest";

import {
  compareDesktopVersions,
  isNewerDesktopVersion,
  parseDesktopVersion,
} from "./desktopVersion";

describe("desktopVersion", () => {
  it("treats sub-releases (2.4.1-a, 2.4.1-b, ..., 2.4.1-aa) as newer than the base version", () => {
    expect(isNewerDesktopVersion("2.4.1-a", "2.4.1")).toBe(true);
    expect(isNewerDesktopVersion("2.4.1a", "2.4.1")).toBe(true);
    expect(isNewerDesktopVersion("2.4.1-b", "2.4.1-a")).toBe(true);
    expect(isNewerDesktopVersion("2.4.1-z", "2.4.1-b")).toBe(true);
    expect(isNewerDesktopVersion("2.4.1-aa", "2.4.1-z")).toBe(true);
    expect(isNewerDesktopVersion("2.4.1-a.1", "2.4.1-a")).toBe(true);
    expect(isNewerDesktopVersion("2.4.1-b", "2.4.1-a.1")).toBe(true);
  });

  it("treats higher base versions as newer than sub-releases of an earlier base version", () => {
    expect(isNewerDesktopVersion("2.4.2", "2.4.1-z")).toBe(true);
    expect(isNewerDesktopVersion("2.4.2", "2.4.1-aa")).toBe(true);
    expect(isNewerDesktopVersion("2.5.0", "2.4.1-a")).toBe(true);
  });

  it("rejects equal versions and downgrades", () => {
    expect(isNewerDesktopVersion("2.4.1", "2.4.1")).toBe(false);
    expect(isNewerDesktopVersion("2.4.1-a", "2.4.1-a")).toBe(false);
    expect(isNewerDesktopVersion("2.4.1", "2.4.1-a")).toBe(false);
    expect(isNewerDesktopVersion("2.4.1-a", "2.4.1-b")).toBe(false);
    expect(isNewerDesktopVersion("2.4.1-z", "2.4.1-aa")).toBe(false);
    expect(isNewerDesktopVersion("2.4.1-b", "2.4.2")).toBe(false);
  });

  it("keeps standard prerelease tags (alpha, beta, rc) older than the base version", () => {
    expect(isNewerDesktopVersion("2.4.2", "2.4.2-alpha.1")).toBe(true);
    expect(isNewerDesktopVersion("2.4.2-beta.1", "2.4.2-alpha.2")).toBe(true);
    expect(isNewerDesktopVersion("2.4.2-rc1", "2.4.2-beta")).toBe(true);
    expect(isNewerDesktopVersion("2.4.2-alpha.1", "2.4.2")).toBe(false);
    expect(compareDesktopVersions("2.4.2-alpha.1", "2.4.1-z")).toBe(1);
  });

  it("handles invalid versions safely", () => {
    expect(parseDesktopVersion("")).toBeNull();
    expect(parseDesktopVersion("invalid")).toBeNull();
    expect(isNewerDesktopVersion("invalid", "2.4.1")).toBe(false);
    expect(isNewerDesktopVersion("2.4.1", "invalid")).toBe(false);
  });
});
