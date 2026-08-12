import classNames from "classnames";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const { genres, countries } = useDiscoverOptions("all", {
    includeCountries: true,
  });
  const primaryNavigationItems = useMemo<
    Array<{ id: Category; label: string }>
  >(
    () => [
      { id: "all", label: t("discover.tabs.all", { defaultValue: "All" }) },
      { id: "tvshows", label: t("discover.tabs.tvshows") },
      { id: "movies", label: t("discover.tabs.movies") },
    ],
    [t],
  );
  const genreNavigationItems = useMemo<Array<{ id: Category; label: string }>>(
    () =>
      genres.map((genre) => ({
        id: `genre:${genre.id}` as const,
        label: genre.name,
      })),
    [genres],
  );
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isNavScrolled, setIsNavScrolled] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const nextIsNavScrolled = container.scrollLeft > 8;
      const nextCanScrollRight =
        container.scrollLeft + container.clientWidth <
        container.scrollWidth - 8;

      setIsNavScrolled(nextIsNavScrolled);
      setCanScrollRight(nextCanScrollRight);
    };

    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(handleScroll);
      resizeObserver.observe(container);

      if (container.firstElementChild instanceof HTMLElement) {
        resizeObserver.observe(container.firstElementChild);
      }
    }

    return () => {
      container.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      resizeObserver?.disconnect();
    };
  }, [genreNavigationItems, primaryNavigationItems]);

  const getButtonClassName = (id: Category, sticky = false) =>
    classNames(
      "shrink-0 rounded-full cursor-pointer flex items-center transition-all duration-200 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 active:outline-none",
      isPrimaryItem(id)
        ? sticky && isNavScrolled
          ? "px-2.5 py-1.5 text-sm font-semibold sm:text-base md:text-lg md:font-bold"
          : "px-2.5 py-1.5 text-base font-semibold sm:text-lg md:px-3 md:py-2 md:text-xl md:font-bold"
        : "px-3 py-1.5 text-xs sm:text-sm md:px-4 md:py-2 md:text-base font-medium bg-mediaCard-hoverBackground",
      selectedCategory === id
        ? isPrimaryItem(id)
          ? sticky && isNavScrolled
            ? "text-type-link"
            : "text-type-link md:scale-105"
          : "bg-mediaCard-hoverBackground text-type-link"
        : isPrimaryItem(id)
          ? "text-type-secondary"
          : "bg-mediaCard-hoverBackground text-type-secondary hover:text-type-primary",
    );
  const isPrimaryItem = (id: Category) =>
    id === "all" || id === "movies" || id === "tvshows";

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
      <div className="relative flex flex-col gap-3 px-2 md:flex-row md:items-center md:gap-2 md:px-0">
        <div className="relative min-w-0 w-full flex-1">
          <div
            ref={scrollContainerRef}
            className="overflow-x-auto scrollbar-none min-w-0 scroll-smooth pr-8 md:pr-0"
          >
            <div className="flex items-center gap-1.5 whitespace-nowrap pr-4 md:gap-2 md:pr-2">
              <div
                className={classNames(
                  "sticky left-0 z-20 flex shrink-0 items-center gap-1.5 pr-2.5 md:gap-2 md:pr-3",
                  isNavScrolled &&
                    "bg-background-main/95 backdrop-blur-sm after:pointer-events-none after:absolute after:inset-y-0 after:-right-5 after:w-5 after:bg-gradient-to-r after:from-background-main after:to-transparent",
                )}
              >
                {primaryNavigationItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={getButtonClassName(item.id, true)}
                    style={{ WebkitTapHighlightColor: "transparent" }}
                    onClick={() => onCategoryChange(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {genreNavigationItems.map((item) => (
                <div key={item.id} className="relative shrink-0">
                  <button
                    type="button"
                    className={getButtonClassName(item.id)}
                    style={{ WebkitTapHighlightColor: "transparent" }}
                    onClick={() => onCategoryChange(item.id)}
                  >
                    {item.label}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {canScrollRight ? (
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center pr-1 md:hidden">
              <div className="absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background-main via-background-main/95 to-transparent" />
              <Icon
                icon={Icons.CHEVRON_RIGHT}
                className="relative text-sm text-type-dimmed/80"
              />
            </div>
          ) : null}
        </div>

        <div className="relative z-20 flex w-full shrink-0 items-center justify-end gap-2 bg-transparent md:w-auto md:pl-3">
          <div className="hidden h-6 w-px shrink-0 bg-white/10 md:block" />

          <div className="relative whitespace-nowrap shrink-0">
            <Dropdown
              selectedItem={selectedCountryOption}
              setSelectedItem={(item) => onCountryChange?.(item.id)}
              options={countryOptions}
              className="!my-0"
              customButton={
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-full bg-mediaCard-hoverBackground px-3 py-1.5 text-xs font-medium text-type-secondary transition-colors hover:bg-mediaCard-background md:px-4 md:py-2 md:text-base"
                >
                  <span className="max-w-[5.5rem] truncate md:max-w-none">
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
                  className="flex items-center gap-1 rounded-full bg-mediaCard-hoverBackground px-3 py-1.5 text-xs font-medium text-type-secondary transition-colors hover:bg-mediaCard-background md:px-4 md:py-2 md:text-base"
                >
                  <span className="max-w-[5.5rem] truncate md:max-w-none">
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
