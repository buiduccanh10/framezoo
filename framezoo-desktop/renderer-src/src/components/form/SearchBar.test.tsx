import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchBarInput } from "@/components/form/SearchBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? _key,
  }),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

describe("SearchBarInput", () => {
  it("renders standard Flare hover border in search mode and switches to animated AI border without Flare.Light in AI mode", async () => {
    const onAiModeChange = vi.fn();

    await act(async () => {
      root.render(
        <SearchBarInput
          value=""
          onChange={() => {}}
          onUnFocus={() => {}}
          aiMode={false}
          onAiModeChange={onAiModeChange}
        />,
      );
    });

    expect(container.querySelector(".flare-light")).not.toBeNull();
    expect(container.querySelector(".ai-search-border-beam")).toBeNull();

    const searchBtn = container.querySelector(
      'button[aria-label="Switch to standard search"]',
    ) as HTMLButtonElement;
    const aiBtn = container.querySelector(
      'button[aria-label="Switch to AI natural language search"]',
    ) as HTMLButtonElement;
    expect(searchBtn.className).toContain("text-type-logo");
    expect(aiBtn.className).toContain("text-white/60");
    expect(aiBtn).not.toBeNull();
    await act(async () => {
      aiBtn.click();
    });
    expect(onAiModeChange).toHaveBeenCalledWith(true);

    await act(async () => {
      root.render(
        <SearchBarInput
          value=""
          onChange={() => {}}
          onUnFocus={() => {}}
          aiMode
          onAiModeChange={onAiModeChange}
        />,
      );
    });

    expect(container.querySelector(".flare-light")).toBeNull();
    expect(container.querySelector(".ai-search-border-beam")).not.toBeNull();
    expect(container.querySelector(".hover\\:flare-enabled")).toBeNull();
    expect(aiBtn.className).toContain("text-type-logo");
    expect(searchBtn.className).toContain("text-white/60");
  });

  it("does not expand the removed TMDB tooltip in standard mode and wraps children inside the search card in AI mode", async () => {
    await act(async () => {
      root.render(
        <SearchBarInput
          value=""
          onChange={() => {}}
          onUnFocus={() => {}}
          aiMode={false}
          onAiModeChange={() => {}}
        />,
      );
    });

    const searchBtn = container.querySelector(
      'button[aria-label="Switch to standard search"]',
    ) as HTMLButtonElement;
    await act(async () => {
      searchBtn.click();
    });
    expect(container.textContent).not.toContain("TMDB ID search");

    await act(async () => {
      root.render(
        <SearchBarInput
          value=""
          onChange={() => {}}
          onUnFocus={() => {}}
          aiMode
          onAiModeChange={() => {}}
        >
          <div data-testid="ai-suggestions">AI suggestions</div>
        </SearchBarInput>,
      );
    });

    const card = container.querySelector(".rounded-\\[28px\\]") as HTMLElement;
    const suggestions = container.querySelector(
      '[data-testid="ai-suggestions"]',
    );
    expect(card).not.toBeNull();
    expect(suggestions).not.toBeNull();
    expect(card.contains(suggestions)).toBe(true);
  });

  it("animates the sliding mode indicator and clear button visibility cleanly", async () => {
    await act(async () => {
      root.render(
        <SearchBarInput
          value=""
          onChange={() => {}}
          onUnFocus={() => {}}
          aiMode={false}
          onAiModeChange={() => {}}
        />,
      );
    });

    const pillIndicator = container.querySelector(
      'span[aria-hidden="true"]',
    ) as HTMLElement;
    const clearButtonWrapper = container.querySelector(
      'div[aria-hidden="true"]',
    ) as HTMLElement;
    expect(pillIndicator.className).toContain("translate-x-0");
    expect(clearButtonWrapper.className).toContain("opacity-0");
    expect(clearButtonWrapper.className).toContain("pointer-events-none");

    await act(async () => {
      root.render(
        <SearchBarInput
          value="interstellar"
          onChange={() => {}}
          onUnFocus={() => {}}
          aiMode
          onAiModeChange={() => {}}
        />,
      );
    });

    expect(pillIndicator.className).toContain("translate-x-[34px]");
    expect(clearButtonWrapper.getAttribute("aria-hidden")).toBe("false");
    expect(clearButtonWrapper.className).toContain("opacity-100");
    expect(clearButtonWrapper.className).toContain("scale-100");
  });
});
