import { act, useState } from "react";
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

  it("keeps standard search single-line and auto-expands AI search textarea up to max lines", async () => {
    await act(async () => {
      root.render(
        <SearchBarInput
          value="the lord of the rings the return of the king extended edition"
          onChange={() => {}}
          onUnFocus={() => {}}
          aiMode={false}
          onAiModeChange={() => {}}
        />,
      );
    });

    expect(container.querySelector("input")).not.toBeNull();
    expect(container.querySelector("textarea")).toBeNull();

    await act(async () => {
      root.render(
        <SearchBarInput
          value=""
          placeholder="Describe what you want to watch (plot, mood, genre, country...)"
          onChange={() => {}}
          onUnFocus={() => {}}
          aiMode
          onAiModeChange={() => {}}
        />,
      );
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const aiPlaceholder = container.querySelector(
      '[data-testid="ai-search-placeholder"]',
    ) as HTMLElement;
    expect(textarea).not.toBeNull();
    expect(textarea.getAttribute("placeholder")).toBeNull();
    expect(textarea.getAttribute("aria-label")).toBe(
      "Describe what you want to watch (plot, mood, genre, country...)",
    );
    expect(aiPlaceholder).not.toBeNull();
    expect(aiPlaceholder.textContent).toBe(
      "Describe what you want to watch (plot, mood, genre, country...)",
    );
    expect(aiPlaceholder.className).toContain("truncate");
    expect(aiPlaceholder.className).toContain("text-start");
    expect(container.querySelector("input")).toBeNull();
    expect(textarea.style.height).toBe("56px");
    expect(textarea.style.overflowY).toBe("hidden");

    let mockedScrollHeight = 104;
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => mockedScrollHeight,
    });

    await act(async () => {
      root.render(
        <SearchBarInput
          value="movie about a man with short-term memory loss who tattoos clues"
          placeholder="Describe what you want to watch (plot, mood, genre, country...)"
          onChange={() => {}}
          onUnFocus={() => {}}
          aiMode
          onAiModeChange={() => {}}
        />,
      );
    });

    expect(
      container.querySelector('[data-testid="ai-search-placeholder"]'),
    ).toBeNull();
    expect(textarea.className).toContain("pr-12");
    expect(textarea.style.height).toBe("104px");
    expect(textarea.style.overflowY).toBe("hidden");

    // Exceeding 4 lines in normal mode clamps at 128px and enables vertical scroll
    mockedScrollHeight = 200;
    await act(async () => {
      root.render(
        <SearchBarInput
          value="very long natural language query spanning more than four lines of wrapped text inside the AI search bar"
          onChange={() => {}}
          onUnFocus={() => {}}
          aiMode
          onAiModeChange={() => {}}
        />,
      );
    });

    expect(textarea.style.height).toBe("128px");
    expect(textarea.style.overflowY).toBe("auto");

    // Sticky mode clamps tighter at 2 lines (80px)
    await act(async () => {
      root.render(
        <SearchBarInput
          value="very long natural language query spanning more than four lines of wrapped text inside the AI search bar"
          onChange={() => {}}
          onUnFocus={() => {}}
          aiMode
          isSticky
          onAiModeChange={() => {}}
        />,
      );
    });

    expect(textarea.style.height).toBe("80px");
    expect(textarea.style.overflowY).toBe("auto");

    // Clearing the value collapses back to single-line height (56px)
    await act(async () => {
      root.render(
        <SearchBarInput
          value=""
          onChange={() => {}}
          onUnFocus={() => {}}
          aiMode
          onAiModeChange={() => {}}
        />,
      );
    });

    expect(textarea.style.height).toBe("56px");
    expect(textarea.style.overflowY).toBe("hidden");
  });

  it("prevents Enter newlines, normalizes line breaks, and keeps focus across mode toggles in AI search", async () => {
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <SearchBarInput
          value=""
          onChange={onChange}
          onUnFocus={() => {}}
          aiMode
          onAiModeChange={() => {}}
        />,
      );
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const enterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      textarea.dispatchEvent(enterEvent);
    });
    expect(enterEvent.defaultPrevented).toBe(true);

    // Simulate pasting text containing line breaks
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(
        textarea,
        "korean thriller\nlike parasite\r\nwith twist",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(
      "korean thriller like parasite with twist",
      true,
    );

    // IME composition Enter should not be prevented
    const composingEnterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(composingEnterEvent, "isComposing", {
      value: true,
    });
    act(() => {
      textarea.dispatchEvent(composingEnterEvent);
    });
    expect(composingEnterEvent.defaultPrevented).toBe(false);

    // Switching from standard to AI mode moves focus to the newly mounted textarea
    function ModeHarness() {
      const [aiMode, setAiMode] = useState(false);
      return (
        <SearchBarInput
          value=""
          onChange={() => {}}
          onUnFocus={() => {}}
          aiMode={aiMode}
          onAiModeChange={setAiMode}
        />
      );
    }

    await act(async () => {
      root.render(<ModeHarness />);
    });

    const aiBtn = container.querySelector(
      'button[aria-label="Switch to AI natural language search"]',
    ) as HTMLButtonElement;
    await act(async () => {
      aiBtn.click();
    });

    const focusedTextarea = container.querySelector(
      "textarea",
    ) as HTMLTextAreaElement;
    expect(focusedTextarea).not.toBeNull();
    expect(document.activeElement).toBe(focusedTextarea);
  });

  it("recalculates AI textarea height when container resizes and aligns clear button at top", async () => {
    let resizeCallback: ResizeObserverCallback | null = null;
    class MockResizeObserver implements ResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        resizeCallback = cb;
      }

      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    try {
      await act(async () => {
        root.render(
          <SearchBarInput
            value="short query that wraps on narrow mobile screens"
            onChange={() => {}}
            onUnFocus={() => {}}
            aiMode
            onAiModeChange={() => {}}
          />,
        );
      });

      const textarea = container.querySelector(
        "textarea",
      ) as HTMLTextAreaElement;
      const clearButtonWrapper = container.querySelector(
        'div[aria-hidden="false"]',
      ) as HTMLElement;
      expect(clearButtonWrapper.className).toContain("top-2");

      let mockedScrollHeight = 56;
      Object.defineProperty(textarea, "scrollHeight", {
        configurable: true,
        get: () => mockedScrollHeight,
      });

      mockedScrollHeight = 104;
      act(() => {
        resizeCallback?.([], {} as ResizeObserver);
      });

      expect(textarea.style.height).toBe("104px");
      expect(textarea.style.overflowY).toBe("hidden");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
