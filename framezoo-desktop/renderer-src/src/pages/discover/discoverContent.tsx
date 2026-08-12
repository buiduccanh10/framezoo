import classNames from "classnames";
import { t } from "i18next";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/buttons/Button";
import { WideContainer } from "@/components/layout/WideContainer";
import { WatchingCarousel } from "@/pages/parts/home/WatchingCarousel";
import { useDiscoverStore } from "@/stores/discover";
import type { Category } from "@/stores/discover";
import { useOverlayStack } from "@/stores/interface/overlayStack";
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

  // Render Movies content with lazy loading
  const renderMoviesContent = () => {
    const carousels = [];

    // Trending Movies
    carousels.push(
      <LazyMediaCarousel
        key="movie-trending"
        content={{ type: "trending" }}
        isTVShow={false}
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        moreContent
        priority={carousels.length < 2}
        {...filtersProps}
      />,
    );

    // Provider Movies
    carousels.push(
      <LazyMediaCarousel
        key="movie-providers"
        content={{ type: "provider" }}
        isTVShow={false}
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        showProviders
        moreContent
        {...filtersProps}
      />,
    );

    // Top Rated
    carousels.push(
      <LazyMediaCarousel
        key="movie-top-rated"
        content={{ type: "topRated" }}
        isTVShow={false}
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        moreContent
        priority={carousels.length < 2}
        {...filtersProps}
      />,
    );

    carousels.push(
      <LazyMediaCarousel
        key="movie-editor-picks"
        content={{ type: "editorPicks" }}
        isTVShow={false}
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        moreContent
        priority={carousels.length < 2}
        {...filtersProps}
      />,
    );

    // Latest Releases
    carousels.push(
      <LazyMediaCarousel
        key="movie-latest"
        content={{ type: "latest", fallback: "nowPlaying" }}
        isTVShow={false}
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        moreContent
        priority={carousels.length < 2}
        {...filtersProps}
      />,
    );

    // For You - personal recommendations from watch history, progress, and bookmarks
    carousels.push(
      <PersonalRecommendationsCarousel
        key="movie-for-you"
        isTVShow={false}
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        {...filtersProps}
      />,
    );

    // Movie Recommendations - only show if there are movie progress items
    if (movieProgressItems.length > 0) {
      carousels.push(
        <LazyMediaCarousel
          key="movie-recommendations"
          content={{ type: "recommendations" }}
          isTVShow={false}
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          moreContent
          showRecommendations
          priority={carousels.length < 2} // First 2 carousels load immediately
          {...filtersProps}
        />,
      );
    }

    // // Top 10 Movies
    // carousels.push(
    //   <LazyMediaCarousel
    //     key="movie-top10"
    //     content={{ type: "top10", fallback: "popular" }}
    //     isTVShow={false}
    //     carouselRefs={carouselRefs}
    //     onShowDetails={handleShowDetails}
    //     moreContent
    //     priority={carousels.length < 2}
    //   />,
    // );

    // Genre Movies
    carousels.push(
      <LazyMediaCarousel
        key="movie-genres"
        content={{ type: "genre" }}
        isTVShow={false}
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        showGenres
        moreContent
        {...filtersProps}
      />,
    );

    // 4K Releases
    // carousels.push(
    //   <LazyMediaCarousel
    //     key="movie-4k"
    //     content={{ type: "latest4k", fallback: "popular" }}
    //     isTVShow={false}
    //     carouselRefs={carouselRefs}
    //     onShowDetails={handleShowDetails}
    //     moreContent
    //     priority={carousels.length < 2}
    //   />,
    // );

    // Addon catalogs — appended last so native content always comes first
    carousels.push(
      <AddonCatalogRow
        key="addon-catalog-movie"
        type="movie"
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
      />,
    );

    return carousels;
  };

  // Render TV Shows content with lazy loading
  const renderTVShowsContent = () => {
    const carousels = [];

    // Trending TV Shows
    carousels.push(
      <LazyMediaCarousel
        key="tv-trending"
        content={{ type: "trending" }}
        isTVShow
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        moreContent
        priority={carousels.length < 2}
        {...filtersProps}
      />,
    );

    // Popular
    // carousels.push(
    //   <LazyMediaCarousel
    //     key="tv-popular"
    //     content={{ type: "popular" }}
    //     isTVShow
    //     carouselRefs={carouselRefs}
    //     onShowDetails={handleShowDetails}
    //     moreContent
    //     priority
    //     {...filtersProps}
    //   />,
    // );

    // Provider TV Shows
    carousels.push(
      <LazyMediaCarousel
        key="tv-providers"
        content={{ type: "provider" }}
        isTVShow
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        showProviders
        moreContent
        {...filtersProps}
      />,
    );

    // Top Rated
    carousels.push(
      <LazyMediaCarousel
        key="tv-top-rated"
        content={{ type: "topRated" }}
        isTVShow
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        moreContent
        priority={carousels.length < 2}
        {...filtersProps}
      />,
    );

    carousels.push(
      <LazyMediaCarousel
        key="tv-editor-picks"
        content={{ type: "editorPicks" }}
        isTVShow
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        moreContent
        priority={carousels.length < 2}
        {...filtersProps}
      />,
    );

    // On Air
    carousels.push(
      <LazyMediaCarousel
        key="tv-on-air"
        content={{ type: "latesttv", fallback: "onTheAir" }}
        isTVShow
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        moreContent
        priority={carousels.length < 2}
        {...filtersProps}
      />,
    );

    // For You - personal recommendations from watch history, progress, and bookmarks
    carousels.push(
      <PersonalRecommendationsCarousel
        key="tv-for-you"
        isTVShow
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        {...filtersProps}
      />,
    );

    // TV Show Recommendations - only show if there are TV show progress items
    if (tvProgressItems.length > 0) {
      carousels.push(
        <LazyMediaCarousel
          key="tv-recommendations"
          content={{ type: "recommendations" }}
          isTVShow
          carouselRefs={carouselRefs}
          onShowDetails={handleShowDetails}
          moreContent
          showRecommendations
          priority={carousels.length < 2} // First 2 carousels load immediately
          {...filtersProps}
        />,
      );
    }

    // Genre TV Shows
    carousels.push(
      <LazyMediaCarousel
        key="tv-genres"
        content={{ type: "genre" }}
        isTVShow
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        showGenres
        moreContent
        {...filtersProps}
      />,
    );

    // Addon catalogs for TV Shows
    carousels.push(
      <AddonCatalogRow
        key="addon-catalog-series"
        type="series"
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
      />,
    );

    return carousels;
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

  const renderAllContent = () => (
    <>
      <LazyMediaCarousel
        key="all-trending"
        content={{ type: "trending" }}
        isTVShow={false}
        isMixed
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        moreContent
        priority
        {...filtersProps}
      />
      <LazyMediaCarousel
        key="all-popular"
        content={{ type: "popular" }}
        isTVShow={false}
        isMixed
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
        moreContent
        priority
        {...filtersProps}
      />
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
      <AddonCatalogRow
        key="addon-catalog-all"
        type="movie"
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
      />
      <AddonCatalogRow
        key="addon-catalog-all-series"
        type="series"
        carouselRefs={carouselRefs}
        onShowDetails={handleShowDetails}
      />
    </>
  );

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
        <Button theme="purple" onClick={() => navigate("/discover/all")}>
          {t("discover.viewLists")}
        </Button>
      </div>

      <ScrollToTopButton />

      {/* DetailsModal is now managed by overlayStack */}
    </div>
  );
}

export default DiscoverContent;
