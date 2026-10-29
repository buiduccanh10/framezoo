import classNames from "classnames";
import { t } from "i18next";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/buttons/Button";
import { WideContainer } from "@/components/layout/WideContainer";
import { WatchingCarousel } from "@/pages/parts/home/WatchingCarousel";
import { useDiscoverStore } from "@/stores/discover";
import type { Category } from "@/stores/discover";
import { useOverlayStack } from "@/stores/interface/overlayStack";
import {
  DEFAULT_HOME_SECTIONS,
  usePreferencesStore,
} from "@/stores/preferences";
import { useProgressStore } from "@/stores/progress";
import { MediaItem } from "@/utils/mediaTypes";

import { AddonCatalogRow } from "./components/AddonCatalogRow";
import { DiscoverNavigation } from "./components/DiscoverNavigation";
import type { FeaturedMedia } from "./components/FeaturedCarousel";
import { LazyMediaCarousel } from "./components/LazyMediaCarousel";
import { PersonalRecommendationsCarousel } from "./components/PersonalRecommendationsCarousel";
import { ScrollToTopButton } from "./components/ScrollToTopButton";
import { useDiscoverOptions } from "./hooks/useDiscoverMedia";

interface DiscoverContentProps {
  filterCountry?: string;
  filterYear?: string;
  onFilterCountryChange?: (country: string) => void;
  onFilterYearChange?: (year: string) => void;
}

export function DiscoverContent({
  filterCountry: externalCountry,
  filterYear: externalYear,
  onFilterCountryChange,
  onFilterYearChange,
}: DiscoverContentProps) {
  const { selectedCategory, setSelectedCategory } = useDiscoverStore();
  const { genres: discoverGenres } = useDiscoverOptions("all");
  const navigate = useNavigate();
  const { showModal } = useOverlayStack();
  const carouselRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const progressItems = useProgressStore((state) => state.items);
  const [internalCountry, setInternalCountry] = useState("");
  const [internalYear, setInternalYear] = useState("");
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set());

  const filterCountry =
    externalCountry !== undefined ? externalCountry : internalCountry;
  const filterYear = externalYear !== undefined ? externalYear : internalYear;
  const handleCountryChange = onFilterCountryChange || setInternalCountry;
  const handleYearChange = onFilterYearChange || setInternalYear;

  useEffect(() => {
    if (selectedCategory === "editorpicks" || selectedCategory === "top10") {
      setSelectedCategory("popular");
    }
  }, [selectedCategory, setSelectedCategory]);

  useEffect(() => {
    setVisitedTabs((prev) => {
      const newSet = new Set(prev);
      newSet.add(selectedCategory);
      return newSet;
    });
  }, [selectedCategory]);

  // Only load data for the active tab
  const isMoviesTab = selectedCategory === "movies";
  const isTVShowsTab = selectedCategory === "tvshows";
  const isAllTab = selectedCategory === "all";
  const isPopularTab =
    selectedCategory === "popular" ||
    selectedCategory === "top10" ||
    selectedCategory === "editorpicks";
  const isGenreTab = selectedCategory.startsWith("genre:");
  const selectedGenreId = isGenreTab
    ? selectedCategory.replace("genre:", "")
    : null;
  const selectedGenreName =
    discoverGenres.find((genre) => genre.id.toString() === selectedGenreId)
      ?.name || "";

  const handleCategoryChange = (category: Category) => {
    setSelectedCategory(category);
  };

  const handleShowDetails = async (media: MediaItem | FeaturedMedia) => {
    showModal("discover-details", {
      id: Number(media.id),
      type: media.type === "movie" ? "movie" : "show",
    });
  };

  const movieProgressItems = Object.entries(progressItems || {}).filter(
    ([_, item]) => item.type === "movie",
  );
  const tvProgressItems = Object.entries(progressItems || {}).filter(
    ([_, item]) => item.type === "show",
  );

  const filtersProps = {
    releaseYear: filterYear || undefined,
    originCountry: filterCountry || undefined,
  };

  const homeSectionOrder =
    usePreferencesStore((s) => s.homeSectionOrder) || DEFAULT_HOME_SECTIONS;

  const dedicatedAddonIds = homeSectionOrder
    .filter((key) => key.startsWith("addon:"))
    .map((key) => key.replace("addon:", ""));

  const sortAndPrioritize = (sectionMap: Record<string, React.ReactNode>) => {
    const orderedKeys = [
      ...homeSectionOrder.filter((key) => key in sectionMap),
      ...Object.keys(sectionMap).filter(
        (key) => !homeSectionOrder.includes(key),
      ),
    ];

    const result: React.ReactNode[] = [];
    orderedKeys.forEach((key) => {
      const node = sectionMap[key];
      if (node) {
        result.push(node);
      }
    });

    return result.map((carousel, index) => {
      if (React.isValidElement(carousel) && index < 2) {
        return React.cloneElement(carousel as React.ReactElement<any>, {
          priority: true,
        });
      }
      return carousel;
    });
  };

  // Render Movies content with lazy loading
  const renderMoviesContent = () => {
    const sectionMap: Record<string, React.ReactNode> = {
      trending: (
        <LazyMediaCarousel
          key="movie-trending"
          content={{ type: "trending" }}
          isTVShow={false}
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          moreContent
          {...filtersProps}
        />
      ),
      providers: (
        <LazyMediaCarousel
          key="movie-providers"
          content={{ type: "provider" }}
          isTVShow={false}
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          showProviders
          moreContent
          {...filtersProps}
        />
      ),
      "top-rated": (
        <LazyMediaCarousel
          key="movie-top-rated"
          content={{ type: "topRated" }}
          isTVShow={false}
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          moreContent
          {...filtersProps}
        />
      ),
      "editor-picks": (
        <LazyMediaCarousel
          key="movie-editor-picks"
          content={{ type: "editorPicks" }}
          isTVShow={false}
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          moreContent
          {...filtersProps}
        />
      ),
      latest: (
        <LazyMediaCarousel
          key="movie-latest"
          content={{ type: "latest", fallback: "nowPlaying" }}
          isTVShow={false}
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          moreContent
          {...filtersProps}
        />
      ),
      "for-you": (
        <PersonalRecommendationsCarousel
          key="movie-for-you"
          isTVShow={false}
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          {...filtersProps}
        />
      ),
      recommendations:
        movieProgressItems.length > 0 ? (
          <LazyMediaCarousel
            key="movie-recommendations"
            content={{ type: "recommendations" }}
            isTVShow={false}
            carouselRefs={carouselRefs}
            onShowDetails={handleShowDetails}
            moreContent
            showRecommendations
            {...filtersProps}
          />
        ) : null,
      genres: (
        <LazyMediaCarousel
          key="movie-genres"
          content={{ type: "genre" }}
          isTVShow={false}
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          showGenres
          moreContent
          {...filtersProps}
        />
      ),
      addons: (
        <AddonCatalogRow
          key="addon-catalog-movie"
          type="movie"
          excludeAddonIds={dedicatedAddonIds}
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
        />
      ),
    };

    dedicatedAddonIds.forEach((addonId) => {
      sectionMap[`addon:${addonId}`] = (
        <AddonCatalogRow
          key={`addon-catalog-movie-${addonId}`}
          type="movie"
          addonId={addonId}
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
        />
      );
    });

    return sortAndPrioritize(sectionMap);
  };

  // Render TV Shows content with lazy loading
  const renderTVShowsContent = () => {
    const sectionMap: Record<string, React.ReactNode> = {
      trending: (
        <LazyMediaCarousel
          key="tv-trending"
          content={{ type: "trending" }}
          isTVShow
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          moreContent
          {...filtersProps}
        />
      ),
      providers: (
        <LazyMediaCarousel
          key="tv-providers"
          content={{ type: "provider" }}
          isTVShow
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          showProviders
          moreContent
          {...filtersProps}
        />
      ),
      "top-rated": (
        <LazyMediaCarousel
          key="tv-top-rated"
          content={{ type: "topRated" }}
          isTVShow
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          moreContent
          {...filtersProps}
        />
      ),
      "editor-picks": (
        <LazyMediaCarousel
          key="tv-editor-picks"
          content={{ type: "editorPicks" }}
          isTVShow
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          moreContent
          {...filtersProps}
        />
      ),
      latest: (
        <LazyMediaCarousel
          key="tv-on-air"
          content={{ type: "latesttv", fallback: "onTheAir" }}
          isTVShow
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          moreContent
          {...filtersProps}
        />
      ),
      "for-you": (
        <PersonalRecommendationsCarousel
          key="tv-for-you"
          isTVShow
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          {...filtersProps}
        />
      ),
      recommendations:
        tvProgressItems.length > 0 ? (
          <LazyMediaCarousel
            key="tv-recommendations"
            content={{ type: "recommendations" }}
            isTVShow
            carouselRefs={carouselRefs}
            onShowDetails={handleShowDetails}
            moreContent
            showRecommendations
            {...filtersProps}
          />
        ) : null,
      genres: (
        <LazyMediaCarousel
          key="tv-genres"
          content={{ type: "genre" }}
          isTVShow
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          showGenres
          moreContent
          {...filtersProps}
        />
      ),
      addons: (
        <AddonCatalogRow
          key="addon-catalog-series"
          type="series"
          excludeAddonIds={dedicatedAddonIds}
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
        />
      ),
    };

    dedicatedAddonIds.forEach((addonId) => {
      sectionMap[`addon:${addonId}`] = (
        <AddonCatalogRow
          key={`addon-catalog-series-${addonId}`}
          type="series"
          addonId={addonId}
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
        />
      );
    });

    return sortAndPrioritize(sectionMap);
  };

  const renderPopularContent = () => {
    return (
      <LazyMediaCarousel
        key="mixed-popular-nav"
        content={{ type: "popular" }}
        isTVShow={false}
        isMixed
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        moreContent
        priority
        {...filtersProps}
      />
    );
  };

  const renderAllContent = () => {
    const sectionMap: Record<string, React.ReactNode> = {
      trending: (
        <LazyMediaCarousel
          key="all-trending"
          content={{ type: "trending" }}
          isTVShow={false}
          isMixed
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          moreContent
          {...filtersProps}
        />
      ),
      popular: (
        <LazyMediaCarousel
          key="all-popular"
          content={{ type: "popular" }}
          isTVShow={false}
          isMixed
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          moreContent
          {...filtersProps}
        />
      ),
      providers: (
        <LazyMediaCarousel
          key="all-providers"
          content={{ type: "provider" }}
          isTVShow={false}
          isMixed
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          showProviders
          moreContent
          {...filtersProps}
        />
      ),
      "top-rated": (
        <LazyMediaCarousel
          key="all-top-rated"
          content={{ type: "topRated" }}
          isTVShow={false}
          isMixed
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          moreContent
          {...filtersProps}
        />
      ),
      "editor-picks": (
        <LazyMediaCarousel
          key="all-editor-picks"
          content={{ type: "editorPicks" }}
          isTVShow={false}
          isMixed
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          moreContent
          {...filtersProps}
        />
      ),
      latest: (
        <LazyMediaCarousel
          key="all-latest"
          content={{ type: "latest" }}
          isTVShow={false}
          isMixed
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          moreContent
          {...filtersProps}
        />
      ),
      genres: (
        <LazyMediaCarousel
          key="all-genres"
          content={{ type: "genre" }}
          isTVShow={false}
          isMixed
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          showGenres
          moreContent
          {...filtersProps}
        />
      ),
      addons: (
        <>
          <AddonCatalogRow
            key="addon-catalog-all"
            type="movie"
            excludeAddonIds={dedicatedAddonIds}
            carouselRefs={carouselRefs}
            onShowDetails={handleShowDetails}
          />
          <AddonCatalogRow
            key="addon-catalog-all-series"
            type="series"
            excludeAddonIds={dedicatedAddonIds}
            carouselRefs={carouselRefs}
            onShowDetails={handleShowDetails}
          />
        </>
      ),
    };

    dedicatedAddonIds.forEach((addonId) => {
      sectionMap[`addon:${addonId}`] = (
        <AddonCatalogRow
          key={`addon-catalog-all-${addonId}`}
          type="movie"
          addonId={addonId}
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
        />
      );
    });

    return <>{sortAndPrioritize(sectionMap)}</>;
  };

  const renderSelectedGenreContent = () => {
    if (!selectedGenreId) return null;

    return (
      <LazyMediaCarousel
        key={`movie-genre-${selectedGenreId}`}
        content={{ type: "genre" }}
        isTVShow={false}
        isMixed
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        moreContent
        priority
        forcedGenreId={selectedGenreId}
        forcedGenreName={selectedGenreName}
        hideRelatedButtons
        {...filtersProps}
      />
    );
  };

  return (
    <div className="relative min-h-screen">
      <WatchingCarousel
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
      />

      <DiscoverNavigation
        selectedCategory={selectedCategory}
        onCategoryChange={handleCategoryChange}
        selectedCountry={filterCountry}
        selectedYear={filterYear}
        onCountryChange={handleCountryChange}
        onYearChange={handleYearChange}
      />

      <WideContainer ultraWide classNames="!px-0">
        {/* All Tab */}
        <div style={{ display: isAllTab ? "block" : "none" }}>
          {(isAllTab || visitedTabs.has("all")) && renderAllContent()}
        </div>

        {/* Movies Tab */}
        <div style={{ display: isMoviesTab ? "block" : "none" }}>
          {(isMoviesTab || visitedTabs.has("movies")) && renderMoviesContent()}
        </div>

        {/* TV Shows Tab */}
        <div style={{ display: isTVShowsTab ? "block" : "none" }}>
          {(isTVShowsTab || visitedTabs.has("tvshows")) &&
            renderTVShowsContent()}
        </div>

        {/* Popular Tab */}
        <div style={{ display: isPopularTab ? "block" : "none" }}>
          {(isPopularTab ||
            visitedTabs.has("popular") ||
            visitedTabs.has("top10") ||
            visitedTabs.has("editorpicks")) &&
            renderPopularContent()}
        </div>

        {/* Genre Movies Tab */}
        <div style={{ display: isGenreTab ? "block" : "none" }}>
          {(isGenreTab ||
            (selectedGenreId && visitedTabs.has(`genre:${selectedGenreId}`))) &&
            renderSelectedGenreContent()}
        </div>
      </WideContainer>

      {/* View All Button */}
      <div
        className={classNames(
          "flex justify-center mt-8 mb-12",
          isAllTab || isMoviesTab || isPopularTab || isGenreTab
            ? "block"
            : "hidden",
        )}
      >
        <Button
          theme="purple"
          onClick={() => {
            window.scrollTo(0, 0);
            navigate("/discover/all");
          }}
        >
          {t("discover.viewLists")}
        </Button>
      </div>

      <ScrollToTopButton />

      {/* DetailsModal is now managed by overlayStack */}
    </div>
  );
}

export default DiscoverContent;
