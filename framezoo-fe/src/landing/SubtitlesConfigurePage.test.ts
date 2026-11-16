import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SUBTITLE_PROVIDERS,
  SubtitlesConfigurePage,
} from "./SubtitlesConfigurePage";

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("SubtitlesConfigurePage", () => {
  it("renders uniform provider cards with official portal URLs and legal links", () => {
    const html = renderToStaticMarkup(createElement(SubtitlesConfigurePage));

    for (const provider of SUBTITLE_PROVIDERS) {
      expect(html).toContain(`data-provider-card="${provider.id}"`);
      expect(html).toContain(`href="${provider.portalUrl}"`);
    }

    expect(html).toContain("https://store.wyzie.io/redeem");
    expect(html).toContain("https://subsource.net/api-docs");
    expect(html).toContain("https://www.opensubtitles.com/consumers");
    expect(html).not.toMatch(/opensubtitles\.org|VLSub/i);
    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('href="/legal/dmca"');
  });

  it("persists keys per provider, toggles visibility, and tests via backend endpoint", async () => {
    (
      globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ valid: true, status: "valid" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(SubtitlesConfigurePage));
    });

    const subsourceCard = container.querySelector(
      '[data-provider-card="subsource"]',
    ) as HTMLElement;
    expect(subsourceCard).toBeTruthy();

    const input = subsourceCard.querySelector("input") as HTMLInputElement;
    expect(input.type).toBe("password");

    const buttons = Array.from(subsourceCard.querySelectorAll("button"));
    const showButton = buttons[0];
    const testButton = buttons[1];

    await act(async () => {
      showButton.click();
    });
    expect(input.type).toBe("text");

    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      valueSetter?.call(input, "sub_live_key");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(window.localStorage.getItem("framezoo.subsource_api_key")).toBe(
      "sub_live_key",
    );

    await act(async () => {
      testButton.click();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/addon/subtitles/api/test",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          provider: "subsource",
          apiKey: "sub_live_key",
        }),
      }),
    );
    expect(subsourceCard.textContent).toContain("✓");

    await act(async () => {
      root.unmount();
    });
  });
});
