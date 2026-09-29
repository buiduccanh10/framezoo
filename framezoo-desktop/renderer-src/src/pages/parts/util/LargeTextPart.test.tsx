import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryRouter } from "react-router-dom";

import { MinimalPageLayout } from "@/pages/layouts/MinimalPageLayout";
import { MigrationPart } from "@/pages/parts/migrations/MigrationPart";
import { LargeTextPart } from "@/pages/parts/util/LargeTextPart";

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

describe("LargeTextPart", () => {
  it("renders with draggable root region and draggable top header", async () => {
    await act(async () => {
      root.render(<LargeTextPart>Đang tải hồ sơ người dùng...</LargeTextPart>);
    });

    const rootElement = container.firstElementChild as HTMLElement;
    expect(rootElement).not.toBeNull();
    expect(rootElement.getAttribute("data-app-region")).toBe("drag");

    const header = rootElement.querySelector(".fixed.top-0.left-0.right-0") as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.getAttribute("data-app-region")).toBe("drag");

    const contentContainer = container.querySelector(".relative.z-10") as HTMLElement;
    expect(contentContainer).not.toBeNull();
    expect(contentContainer.getAttribute("data-app-region")).toBe("no-drag");
    expect(contentContainer.textContent).toContain("Đang tải hồ sơ người dùng...");
  });

  it("renders MigrationPart using draggable LargeTextPart structure", async () => {
    await act(async () => {
      root.render(<MigrationPart />);
    });

    const rootElement = container.firstElementChild as HTMLElement;
    expect(rootElement).not.toBeNull();
    expect(rootElement.getAttribute("data-app-region")).toBe("drag");
  });

  it("renders MinimalPageLayout using matching draggable header structure", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <MinimalPageLayout>
            <div>Content</div>
          </MinimalPageLayout>
        </MemoryRouter>,
      );
    });

    const rootElement = container.firstElementChild as HTMLElement;
    expect(rootElement).not.toBeNull();

    const header = rootElement.querySelector(".fixed.top-0.left-0.right-0") as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.getAttribute("data-app-region")).toBe("drag");
  });
});



