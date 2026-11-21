import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import enLocale from "@/assets/locales/en.json";
import viLocale from "@/assets/locales/vi.json";

import { DetailsInfo } from "./DetailsInfo";

let currentLocale: "en" | "vi" = "en";

function lookupKey(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = key
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[part]
          : undefined,
      obj,
    );
  return typeof value === "string" ? value : undefined;
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const source = currentLocale === "vi" ? viLocale : enLocale;
      return lookupKey(source, key) ?? key;
    },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));

vi.mock("./DetailsRatings", () => ({
  DetailsRatings: () => null,
}));

describe("DetailsInfo", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    currentLocale = "en";
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

  it("uses localized details.collection.label across languages and keeps collection name", () => {
    const onCollectionClick = vi.fn();
    const movieData = {
      id: 866398,
      title: "The Beekeeper",
      type: "movie" as const,
      collection: {
        id: 12345,
        name: "The Beekeeper Collection",
        poster_path: null,
        backdrop_path: null,
      },
    };

    act(() => {
      root.render(
        <DetailsInfo data={movieData} onCollectionClick={onCollectionClick} />,
      );
    });

    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.textContent).toContain("Collection");
    expect(button.textContent).toContain("The Beekeeper Collection");

    currentLocale = "vi";
    act(() => {
      root.render(
        <DetailsInfo data={movieData} onCollectionClick={onCollectionClick} />,
      );
    });

    expect(button.textContent).toContain("Bộ sưu tập");
    expect(button.textContent).not.toContain("CollectionThe");

    act(() => {
      button.click();
    });
    expect(onCollectionClick).toHaveBeenCalledTimes(1);
  });
});
