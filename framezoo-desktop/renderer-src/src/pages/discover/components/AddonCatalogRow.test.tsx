import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { AddonCatalogRow } from "./AddonCatalogRow";

const catalog = vi.hoisted(() => ({
  hasIntersected: false,
  load: vi.fn(),
}));

vi.mock("@/desktop/addons/catalog", () => ({
  loadAllAddonCatalogs: catalog.load,
}));
vi.mock("@/desktop/addons/store", () => ({
  useInstalledAddons: () => [],
}));
vi.mock("@/hooks/useIntersectionObserver", () => ({
  useIntersectionObserver: () => ({
    ref: () => {},
    hasIntersected: catalog.hasIntersected,
  }),
}));
vi.mock("@/components/media/MediaCard", () => ({
  MediaCardSkeleton: () => <div data-testid="card-skeleton" />,
}));

it("keeps addon card skeletons visible before intersection and while retrying", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  document.body.appendChild(container);
  catalog.load.mockResolvedValue({ items: [], errors: [new Error("offline")] });

  try {
    await act(async () => root.render(<AddonCatalogRow type="movie" />));
    expect(
      container.querySelectorAll('[data-testid="card-skeleton"]'),
    ).toHaveLength(7);

    catalog.hasIntersected = true;
    await act(async () => root.render(<AddonCatalogRow type="movie" />));
    expect(catalog.load).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(
      container.querySelectorAll('[data-testid="card-skeleton"]'),
    ).toHaveLength(7);
  } finally {
    act(() => root.unmount());
    container.remove();
    catalog.hasIntersected = false;
    catalog.load.mockReset();
  }
});
