import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LandingLanguageSelector } from "./LandingLanguageSelector";

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
});

describe("LandingLanguageSelector", () => {
  it("portals the dropdown outside the sticky backdrop-filter nav", async () => {
    (
      globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    const nav = document.createElement("header");
    nav.className = "landing-nav";
    document.body.appendChild(nav);
    const root = createRoot(nav);
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        createElement(LandingLanguageSelector, {
          locale: "en",
          label: "Language",
          onChange,
        }),
      );
    });

    const toggle = nav.querySelector(
      ".landing-language-toggle",
    ) as HTMLButtonElement;
    expect(toggle).toBeTruthy();

    await act(async () => {
      toggle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    // Wait one microtask/frame for Radix Popper placement
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const menuInNav = nav.querySelector(".landing-language-options");
    const menuInBody = document.body.querySelector(".landing-language-options");
    expect(menuInNav).toBeNull();
    expect(menuInBody).toBeTruthy();
    expect(
      menuInBody?.closest("[data-radix-popper-content-wrapper]")?.parentElement,
    ).toBe(document.body);

    const viOption = Array.from(
      document.body.querySelectorAll(".landing-language-option"),
    ).find((el) => el.textContent?.includes("Tiếng Việt")) as HTMLElement;
    expect(viOption).toBeTruthy();

    await act(async () => {
      viOption.click();
    });

    expect(onChange).toHaveBeenCalledWith("vi");
    expect(window.localStorage.getItem("framezoo-landing-locale")).toBe("vi");

    await act(async () => {
      root.unmount();
    });
  });
});
