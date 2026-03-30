import { useTranslation } from "react-i18next";

import { useDiscoverOptions } from "@/pages/discover/hooks/useDiscoverMedia";
import type { Category } from "@/stores/discover";

interface DiscoverNavigationProps {
  selectedCategory: Category;
  onCategoryChange: (category: Category) => void;
}

export function DiscoverNavigation({
  selectedCategory,
  onCategoryChange,
}: DiscoverNavigationProps) {
  const { t } = useTranslation();
  const { genres } = useDiscoverOptions("movie");
  const navigationItems: Array<{ id: Category; label: string }> = [
    { id: "movies", label: t("discover.tabs.movies") },
    { id: "tvshows", label: t("discover.tabs.tvshows") },
    { id: "top10", label: t("discover.tabs.top10") },
    ...genres.map((genre) => ({
      id: `genre:${genre.id}` as const,
      label: genre.name,
    })),
  ];
  const isPrimaryItem = (id: Category) =>
    id === "movies" || id === "tvshows" || id === "top10";

  return (
    <div className="pb-4 w-full max-w-screen-xl mx-auto">
      <div className="relative overflow-x-auto scrollbar-none px-2 md:px-0">
        <div className="flex w-max min-w-full items-center gap-2 whitespace-nowrap">
          {navigationItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`shrink-0 rounded-full cursor-pointer flex items-center transition-all duration-200 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 active:outline-none ${
                isPrimaryItem(item.id)
                  ? "px-3 py-2 text-lg md:text-xl font-bold"
                  : "px-4 py-2 text-sm md:text-base font-medium bg-mediaCard-hoverBackground"
              } ${
                selectedCategory === item.id
                  ? isPrimaryItem(item.id)
                    ? "scale-105 text-type-link"
                    : "bg-mediaCard-hoverBackground text-type-link"
                  : isPrimaryItem(item.id)
                    ? "text-type-secondary"
                    : "bg-mediaCard-hoverBackground text-type-secondary hover:text-type-primary"
              }`}
              style={{ WebkitTapHighlightColor: "transparent" }}
              onClick={() => onCategoryChange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
