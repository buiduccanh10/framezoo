import { useCallback, useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { To, useNavigate } from "react-router-dom";

import { ActionPillButton } from "@/components/buttons/ActionPillButton";
import { OptionItem } from "@/components/form/Dropdown";
import { WideContainer } from "@/components/layout/WideContainer";
import { useDebounce } from "@/hooks/useDebounce";
import { useRandomTranslation } from "@/hooks/useRandomTranslation";
import { useSearchQuery } from "@/hooks/useSearchQuery";
import { FeaturedCarousel } from "@/pages/discover/components/FeaturedCarousel";
import type { FeaturedMedia } from "@/pages/discover/components/FeaturedCarousel";
import DiscoverContent from "@/pages/discover/discoverContent";
import { useDiscoverOptions } from "@/pages/discover/hooks/useDiscoverMedia";
import { HomeLayout } from "@/pages/layouts/HomeLayout";
import { BookmarksCarousel } from "@/pages/parts/home/BookmarksCarousel";
import { BookmarksPart } from "@/pages/parts/home/BookmarksPart";
import { HeroPart } from "@/pages/parts/home/HeroPart";
import { WatchingCarousel } from "@/pages/parts/home/WatchingCarousel";
import { WatchingPart } from "@/pages/parts/home/WatchingPart";
import { SearchListPart } from "@/pages/parts/search/SearchListPart";
import { SearchLoadingPart } from "@/pages/parts/search/SearchLoadingPart";
import { conf } from "@/setup/config";
import { useOverlayStack } from "@/stores/interface/overlayStack";
import { usePreferencesStore } from "@/stores/preferences";
import { MediaItem } from "@/utils/mediaTypes";

import { AdsPart } from "./parts/home/AdsPart";
import { SupportBar } from "./parts/home/SupportBar";

function useSearch(search: string) {
  const [searching, setSearching] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const debouncedSearch = useDebounce<string>(search, 500);
  useEffect(() => {
    setSearching(search !== "");
    setLoading(search !== "");
    if (search !== "") {
      window.scrollTo(0, 0);
    }
  }, [search]);
  useEffect(() => {
    setLoading(false);
  }, [debouncedSearch]);

  return {
    loading,
    searching,
  };
}

// What the sigma?

export function HomePage() {
  const { t } = useTranslation();
  const { t: randomT } = useRandomTranslation();
  const emptyText = randomT(`home.search.empty`);
  const navigate = useNavigate();
  const [showBg, setShowBg] = useState<boolean>(false);
  const searchParams = useSearchQuery();
  const [search] = searchParams;
  const s = useSearch(search);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showWatching, setShowWatching] = useState(false);
  const { showModal } = useOverlayStack();
  const enableDiscover = usePreferencesStore((state) => state.enableDiscover);
  const enableFeatured = usePreferencesStore((state) => state.enableFeatured);
  const carouselRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const enableCarouselView = usePreferencesStore(
    (state) => state.enableCarouselView,
  );
  const enableLowPerformanceMode = usePreferencesStore(
    (state) => state.enableLowPerformanceMode,
  );
  const homeSectionOrder = usePreferencesStore(
    (state) => state.homeSectionOrder,
  );
  const [filterCountry, setFilterCountry] = useState("");
  const [filterYear, setFilterYear] = useState("");

  const { countries } = useDiscoverOptions("movie", {
    includeCountries: true,
  });
  const countryLabel = t("discover.filters.country", {
    defaultValue: "Country",
  });
  const countryOptions: OptionItem[] = [
    { id: "", name: countryLabel },
    ...countries,
  ];
  const selectedCountryOption =
    countryOptions.find((o) => o.id === filterCountry) || countryOptions[0];
  const yearOptions: OptionItem[] = (() => {
    const currentYear = new Date().getFullYear();
    return [
      { id: "", name: t("home.bookmarks.edit.yearLabel") },
      ...Array.from({ length: currentYear - 1899 }, (_, i) => {
        const year = (currentYear - i).toString();
        return { id: year, name: year };
      }),
    ];
  })();
  const selectedYearOption =
    yearOptions.find((o) => o.id === filterYear) || yearOptions[0];

  const [featuredContentReady, setFeaturedContentReady] =
    useState(!enableFeatured);

  useEffect(() => {
    setFeaturedContentReady(!enableFeatured);
  }, [enableFeatured]);

  const handleFeaturedContentReady = useCallback(() => {
    setFeaturedContentReady(true);
  }, []);

  const handleClick = (path: To) => {
    window.scrollTo(0, 0);
    navigate(path);
  };

  const handleShowDetails = async (media: MediaItem | FeaturedMedia) => {
    showModal("details", {
      id: Number(media.id),
      type: media.type === "movie" ? "movie" : "show",
    });
  };

  const _renderHomeSections = () => {
    const sections = homeSectionOrder.map((section) => {
      switch (section) {
        case "watching":
          return enableCarouselView ? (
            <WatchingCarousel
              key="watching"
              carouselRefs={carouselRefs}
              onShowDetails={handleShowDetails}
            />
          ) : (
            <WatchingPart
              key="watching"
              onItemsChange={setShowWatching}
              onShowDetails={handleShowDetails}
            />
          );
        case "bookmarks":
          return enableCarouselView ? (
            <BookmarksCarousel
              key="bookmarks"
              carouselRefs={carouselRefs}
              onShowDetails={handleShowDetails}
            />
          ) : (
            <BookmarksPart
              key="bookmarks"
              onItemsChange={setShowBookmarks}
              onShowDetails={handleShowDetails}
            />
          );
        default:
          return null;
      }
    });

    if (enableCarouselView) {
      return (
        <WideContainer ultraWide classNames="!px-3 md:!px-9">
          {sections}
        </WideContainer>
      );
    }
    return (
      <WideContainer>
        <div className="flex flex-col gap-8">{sections}</div>
      </WideContainer>
    );
  };

  const shouldRenderDiscoverContent =
    enableDiscover &&
    !search &&
    !enableLowPerformanceMode &&
    (!enableFeatured || featuredContentReady);
  const shouldShowDiscoverButton =
    !enableDiscover && !search && !enableLowPerformanceMode;

  return (
    <HomeLayout showBg={showBg}>
      <div className="mb-2">
        <Helmet>
          <style type="text/css">{`
            html, body {
              scrollbar-gutter: stable;
            }
          `}</style>
          <title>{t("global.name")}</title>
        </Helmet>

        {/* Page Header */}
        {enableFeatured ? (
          <FeaturedCarousel
            forcedCategory="tvshows"
            onShowDetails={handleShowDetails}
            onInitialContentReady={handleFeaturedContentReady}
            searching={s.searching}
            shorter
          >
            <HeroPart
              searchParams={searchParams}
              setIsSticky={setShowBg}
              isInFeatured
            />
          </FeaturedCarousel>
        ) : (
          <HeroPart
            searchParams={searchParams}
            setIsSticky={setShowBg}
            showTitle
          />
        )}

        {conf().SHOW_SUPPORT_BAR ? <SupportBar /> : null}

        {conf().SHOW_AD ? <AdsPart /> : null}
      </div>

      {/* Search */}
      {search && (
        <WideContainer>
          {s.loading ? (
            <SearchLoadingPart />
          ) : (
            s.searching && (
              <SearchListPart
                searchQuery={search}
                onShowDetails={handleShowDetails}
                filterCountry={filterCountry}
                filterYear={filterYear}
                onCountryChange={setFilterCountry}
                onYearChange={setFilterYear}
                countryOptions={countryOptions}
                yearOptions={yearOptions}
                countryLabel={countryLabel}
                selectedCountryOption={selectedCountryOption}
                selectedYearOption={selectedYearOption}
              />
            )
          )}
        </WideContainer>
      )}

      {/* User Content */}
      {/* {!search && renderHomeSections()} */}

      {/* Under user content */}
      <WideContainer ultraWide classNames="!px-3 md:!px-9">
        {/* Empty text */}
        {!(showBookmarks || showWatching) &&
        (!enableDiscover || enableLowPerformanceMode) ? (
          <div className="flex flex-col translate-y-[-30px] items-center justify-center pt-20">
            <p className="text-[18.5px] pb-3">{emptyText}</p>
          </div>
        ) : null}

        {/* Discover Spacing */}
        {enableDiscover &&
          (enableFeatured ? (
            <div className="pb-4" />
          ) : showBookmarks || showWatching ? (
            <div className="pb-10" />
          ) : (
            <div className="pb-20" />
          ))}
        {/* there... perfect. */}

        {/* Discover section or discover button */}
        {shouldRenderDiscoverContent ? (
          <DiscoverContent
            filterCountry={filterCountry}
            filterYear={filterYear}
            onFilterCountryChange={setFilterCountry}
            onFilterYearChange={setFilterYear}
          />
        ) : shouldShowDiscoverButton ? (
          <div className="flex flex-col justify-center items-center h-40 space-y-4">
            <div className="flex flex-col items-center justify-center">
              {!search && !enableLowPerformanceMode && (
                <ActionPillButton
                  className="px-py p-[0.35em] mt-3 rounded-xl text-type-dimmed box-content text-[18px] bg-largeCard-background justify-center items-center"
                  onClick={() => handleClick("/discover")}
                >
                  {t("home.search.discover")}
                </ActionPillButton>
              )}
            </div>
          </div>
        ) : null}
      </WideContainer>
    </HomeLayout>
  );
}
