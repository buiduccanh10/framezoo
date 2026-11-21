import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSearchQuery } from "@/hooks/useSearchQuery";

import { HeroPart } from "./HeroPart";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? _key,
  }),
}));

vi.mock("@/hooks/useRandomTranslation", () => ({
  useRandomTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => ({ isMobile: false }),
  useIsIOS: () => false,
  useIsPWA: () => false,
}));

vi.mock("@/hooks/useIsTv", () => ({
  useIsTV: () => ({ isTV: false }),
}));

let observerCallback: IntersectionObserverCallback | null = null;

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly scrollMargin = "0px";
  readonly thresholds = [1];
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    observerCallback = callback;
  }

  observe = vi.fn(() => {
    this.callback(
      [
        {
          isIntersecting: true,
          intersectionRatio: 1,
        } as IntersectionObserverEntry,
      ],
      this,
    );
  });

  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = () => [];
}

function HeroHarness({ setIsSticky }: { setIsSticky: (val: boolean) => void }) {
  const searchParams = useSearchQuery();
  return <HeroPart setIsSticky={setIsSticky} searchParams={searchParams} />;
}

describe("HeroPart sticky search bar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    observerCallback = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  function triggerIntersection(isIntersecting: boolean) {
    act(() => {
      observerCallback?.(
        [
          {
            isIntersecting,
            intersectionRatio: isIntersecting ? 1 : 0,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
  }

  it("pins both manual and AI search bars as fixed when scrolled past topOffset without remounting input", () => {
    const setIsSticky = vi.fn();

    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/browse"]}>
          <Routes>
            <Route
              path="/browse"
              element={<HeroHarness setIsSticky={setIsSticky} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    const inputBefore = container.querySelector("input");
    expect(container.querySelector(".fixed")).toBeNull();

    triggerIntersection(false);
    expect(setIsSticky).toHaveBeenLastCalledWith(true);
    expect(container.querySelector(".fixed")).not.toBeNull();
    expect(container.querySelector("input")).toBe(inputBefore);

    // Switch to AI mode while sticky — switches to auto-expanding textarea, stays fixed, and keeps glowing AI border
    const aiBtn = container.querySelector(
      'button[aria-label="Switch to AI natural language search"]',
    ) as HTMLButtonElement;
    act(() => {
      aiBtn.click();
    });

    const textareaInAi = container.querySelector("textarea");
    expect(container.querySelector(".fixed")).not.toBeNull();
    expect(container.querySelector(".ai-search-border-beam")).not.toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(textareaInAi).not.toBeNull();
    // Compact sticky bar collapses the multi-row suggestions smoothly while scrolled
    const drawerWhileSticky = container.querySelector(
      '[data-testid="ai-guide-drawer"]',
    ) as HTMLElement;
    expect(drawerWhileSticky.getAttribute("aria-hidden")).toBe("true");
    expect(drawerWhileSticky.className).toContain("grid-rows-[0fr]");
    expect(drawerWhileSticky.className).toContain("opacity-0");
    expect(
      (drawerWhileSticky.querySelector("button") as HTMLButtonElement).disabled,
    ).toBe(true);

    // Scrolling back to top expands suggestions back open inside the search box without remounting the textarea
    triggerIntersection(true);
    expect(setIsSticky).toHaveBeenLastCalledWith(false);
    expect(container.querySelector(".fixed")).toBeNull();
    expect(container.querySelector("textarea")).toBe(textareaInAi);
    expect(drawerWhileSticky.getAttribute("aria-hidden")).toBe("false");
    expect(drawerWhileSticky.className).toContain("grid-rows-[1fr]");
    expect(drawerWhileSticky.className).toContain("opacity-100");
    expect(
      (drawerWhileSticky.querySelector("button") as HTMLButtonElement).disabled,
    ).toBe(false);

    // Pressing "/" inside the AI textarea must not be intercepted by useSlashFocus
    textareaInAi!.focus();
    const slashEvent = new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(slashEvent);
    });
    expect(slashEvent.defaultPrevented).toBe(false);
  });
});
