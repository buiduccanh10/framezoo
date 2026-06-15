import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Dropdown, OptionItem } from "@/components/form/Dropdown";
import { Icon, Icons } from "@/components/Icon";
import { useDiscoverOptions } from "@/pages/discover/hooks/useDiscoverMedia";
import type { Category } from "@/stores/discover";

interface DiscoverNavigationProps {
  selectedCategory: Category;
  onCategoryChange: (category: Category) => void;
  selectedCountry?: string;
  selectedYear?: string;
  onCountryChange?: (country: string) => void;
  onYearChange?: (year: string) => void;
}

export function DiscoverNavigation({
  selectedCategory,
  onCategoryChange,
  selectedCountry = "",
  selectedYear = "",
  onCountryChange,
  onYearChange,
}: DiscoverNavigationProps) {
  const { t } = useTranslation();
  const { genres, countries } = useDiscoverOptions("movie", {
    includeCountries: true,
  });
  const navigationItems: Array<{ id: Category; label: string }> = [
    { id: "tvshows", label: t("discover.tabs.tvshows") },
    { id: "movies", label: t("discover.tabs.movies") },
    { id: "top10", label: t("discover.tabs.top10") },
    ...genres.map((genre) => ({
      id: `genre:${genre.id}` as const,
      label: genre.name,
    })),
  ];
  const isPrimaryItem = (id: Category) =>
    id === "movies" || id === "tvshows" || id === "top10";

  const countryLabel = t("discover.filters.country", {
    defaultValue: "Country",
  });
  const countryOptions: OptionItem[] = useMemo(
    () => [{ id: "", name: countryLabel }, ...countries],
    [countryLabel, countries],
  );
  const selectedCountryOption =
    countryOptions.find((option) => option.id === selectedCountry) ||
    countryOptions[0];

  const yearOptions: OptionItem[] = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: currentYear - 1899 }, (_, index) => {
      const year = (currentYear - index).toString();
      return { id: year, name: year };
    });
    return [{ id: "", name: t("home.bookmarks.edit.yearLabel") }, ...years];
  }, [t]);
  const selectedYearOption =
    yearOptions.find((option) => option.id === selectedYear) || yearOptions[0];

  return (
    <div className="pb-4 w-full max-w-screen-xl mx-auto">
      <div className="relative flex items-center px-2 md:px-0">
        <div className="overflow-x-auto scrollbar-none flex-1 min-w-0">
          <div className="flex items-center gap-2 whitespace-nowrap">
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

        <div className="sticky right-0 z-10 shrink-0 flex items-center gap-2 bg-background-main pl-3">
          <div className="w-px h-6 bg-white/10 shrink-0" />

          <div className="relative whitespace-nowrap shrink-0">
            <Dropdown
              selectedItem={selectedCountryOption}
              setSelectedItem={(item) => onCountryChange?.(item.id)}
              options={countryOptions}
              customButton={
                <button
                  type="button"
                  className="px-3 py-1 text-sm bg-mediaCard-hoverBackground rounded-full hover:bg-mediaCard-background transition-colors flex items-center gap-1"
                >
                  <span>
                    {selectedCountry
                      ? `${countryLabel}: ${selectedCountryOption.name}`
                      : countryLabel}
                  </span>
                  <Icon
                    icon={Icons.UP_DOWN_ARROW}
                    className="text-xs text-dropdown-secondary"
                  />
                </button>
              }
            />
          </div>

          <div className="relative whitespace-nowrap shrink-0">
            <Dropdown
              selectedItem={selectedYearOption}
              setSelectedItem={(item) => onYearChange?.(item.id)}
              options={yearOptions}
              customButton={
                <button
                  type="button"
                  className="px-3 py-1 text-sm bg-mediaCard-hoverBackground rounded-full hover:bg-mediaCard-background transition-colors flex items-center gap-1"
                >
                  <span>
                    {selectedYear
                      ? `${t("home.bookmarks.edit.yearLabel")}: ${selectedYear}`
                      : t("home.bookmarks.edit.yearLabel")}
                  </span>
                  <Icon
                    icon={Icons.UP_DOWN_ARROW}
                    className="text-xs text-dropdown-secondary"
                  />
                </button>
              }
              preventWrap
              className="!my-0"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
