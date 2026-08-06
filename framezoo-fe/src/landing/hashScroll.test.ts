import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getLandingHashId,
  navigateToLandingHash,
  scrollToLandingHash,
} from "./hashScroll";

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("landing hash navigation", () => {
  it("decodes a target id from the URL hash", () => {
    expect(getLandingHashId("#addon-guide")).toBe("addon-guide");
    expect(getLandingHashId("#addon%2Dguide")).toBe("addon-guide");
    expect(getLandingHashId("")).toBeNull();
  });

  it("scrolls to the target after the app has rendered", () => {
    document.body.innerHTML = `
      <header class="landing-nav"></header>
      <section id="addon-guide"></section>
    `;
    const navigation = document.querySelector<HTMLElement>(".landing-nav");
    const target = document.getElementById("addon-guide");
    if (!navigation || !target) {
      throw new Error("Landing fixture is incomplete");
    }

    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 200,
    });
    vi.spyOn(navigation, "getBoundingClientRect").mockReturnValue({
      height: 76,
    } as DOMRect);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 500,
    } as DOMRect);

    expect(scrollToLandingHash("#addon-guide", "instant")).toBe(true);
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 606,
      behavior: "instant",
    });
  });

  it("updates the hash and smoothly scrolls to a landing section", () => {
    document.body.innerHTML = `
      <header class="landing-nav"></header>
      <section id="download"></section>
    `;
    const navigation = document.querySelector<HTMLElement>(".landing-nav");
    const target = document.getElementById("download");
    if (!navigation || !target) {
      throw new Error("Landing fixture is incomplete");
    }

    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 0,
    });
    vi.spyOn(navigation, "getBoundingClientRect").mockReturnValue({
      height: 76,
    } as DOMRect);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 500,
    } as DOMRect);
    const pushState = vi.spyOn(window.history, "pushState");

    expect(navigateToLandingHash("#download")).toBe(true);
    expect(pushState).toHaveBeenCalledWith(null, "", "#download");
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 406,
      behavior: "smooth",
    });
  });

  it("does nothing when the hash target is not rendered", () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    expect(scrollToLandingHash("#missing")).toBe(false);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
