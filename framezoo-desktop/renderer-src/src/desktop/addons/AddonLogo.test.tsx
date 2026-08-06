import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/utils/Image", () => ({
  LazyImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img {...props} />
  ),
}));

import { AddonLogo } from "./AddonLogo";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("AddonLogo", () => {
  it("renders the fallback icon when the logo is missing", async () => {
    await act(async () => {
      root.render(<AddonLogo name="Missing addon" />);
    });

    expect(
      container.querySelector('[aria-label="Missing addon addon icon"]'),
    ).not.toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders the configured logo", async () => {
    await act(async () => {
      root.render(
        <AddonLogo name="Example addon" logo="https://example.com/logo.svg" />,
      );
    });

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/logo.svg",
    );
  });

  it("switches to the fallback icon when the logo fails", async () => {
    await act(async () => {
      root.render(
        <AddonLogo name="Broken addon" logo="https://example.com/logo.svg" />,
      );
    });

    const image = container.querySelector("img");
    expect(image).not.toBeNull();

    await act(async () => {
      image?.dispatchEvent(new Event("error"));
    });

    expect(
      container.querySelector('[aria-label="Broken addon addon icon"]'),
    ).not.toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
