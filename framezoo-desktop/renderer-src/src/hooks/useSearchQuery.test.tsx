import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSearchQuery } from "./useSearchQuery";

let latestHook: ReturnType<typeof useSearchQuery>;
let latestLocation = "";

function SearchHarness() {
  const result = useSearchQuery();
  const location = useLocation();
  latestHook = result;
  latestLocation = `${location.pathname}${location.search}`;
  return null;
}

describe("useSearchQuery", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT;
  });

  function mountAt(initialEntry: string) {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/browse" element={<SearchHarness />} />
            <Route path="/browse/:query" element={<SearchHarness />} />
          </Routes>
        </MemoryRouter>,
      );
    });
  }

  it("clears search input and query URL when switching from standard to AI search", () => {
    mountAt("/browse/batman");
    expect(latestHook[0]).toBe("batman");
    expect(latestHook[3]).toBe(false);

    act(() => {
      latestHook[4](true);
    });

    expect(latestHook[0]).toBe("");
    expect(latestHook[3]).toBe(true);
    expect(latestLocation).toBe("/browse?mode=ai");
  });

  it("clears search input and query URL when switching from AI to standard search", () => {
    mountAt("/browse/phim%20kinh%20di?mode=ai");
    expect(latestHook[0]).toBe("phim kinh di");
    expect(latestHook[3]).toBe(true);

    act(() => {
      latestHook[4](false);
    });

    expect(latestHook[0]).toBe("");
    expect(latestHook[3]).toBe(false);
    expect(latestLocation).toBe("/browse");
  });

  it("keeps existing search text when re-selecting the already active mode", () => {
    mountAt("/browse/inception?mode=ai");

    act(() => {
      latestHook[4](true);
    });

    expect(latestHook[0]).toBe("inception");
    expect(latestHook[3]).toBe(true);
    expect(latestLocation).toBe("/browse/inception?mode=ai");
  });
});
