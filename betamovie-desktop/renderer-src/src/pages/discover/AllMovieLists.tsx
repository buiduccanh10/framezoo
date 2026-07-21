import { t } from "i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";

import {
  getCuratedMovieLists,
  getMovieDetailsForIds,
} from "@/backend/metadata/traktApi";
import { TMDBMovieData } from "@/backend/metadata/types/tmdb";
import type { CuratedMovieList } from "@/backend/metadata/types/trakt";
import { Icon, Icons } from "@/components/Icon";
import { WideContainer } from "@/components/layout/WideContainer";
import { MediaCard } from "@/components/media/MediaCard";
import { Heading1 } from "@/components/utils/Text";
import { useIsMobile } from "@/hooks/useIsMobile";
import { getDiscoverBackUrl } from "@/pages/discover/utils/navigation";
import { SubPageLayout } from "@/pages/layouts/SubPageLayout";
import { conf } from "@/setup/config";
import { useDiscoverStore } from "@/stores/discover";
import { useOverlayStack } from "@/stores/interface/overlayStack";
import { MediaItem } from "@/utils/mediaTypes";

import { CarouselNavButtons } from "./components/CarouselNavButtons";
import { LazyMediaCarousel } from "./components/LazyMediaCarousel";

export function DiscoverMore() {
  const [curatedLists, setCuratedLists] = useState<CuratedMovieList[]>([]);
  const [movieDetails, setMovieDetails] = useState<{
    [listSlug: string]: TMDBMovieData[];
  }>({});
  const { showModal } = useOverlayStack();
  const carouselRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const navigate = useNavigate();
  const { lastView } = useDiscoverStore();
  const { isMobile } = useIsMobile();
  const visibleCuratedLists = useMemo(
    () =>
      curatedLists.filter(
        (list) => (movieDetails[list.listSlug]?.length ?? 0) > 0,
      ),
    [curatedLists, movieDetails],
  );

  useEffect(() => {
    if (!conf().USE_TRAKT) return;

    const fetchCuratedLists = async () => {
      try {
        const lists = await getCuratedMovieLists();
        setCuratedLists(lists);

        const details: { [listSlug: string]: TMDBMovieData[] } = {};
        for (const list of lists) {
          try {
            const movies = await getMovieDetailsForIds(list.tmdbIds, 50);
            if (movies.length > 0) {
              details[list.listSlug] = movies;
              setMovieDetails({ ...details });
            }
          } catch (error) {
            console.error(
              `Failed to fetch movies for list ${list.listSlug}:`,
              error,
            );
          }
        }
      } catch (error) {
        console.error("Failed to fetch curated lists:", error);
      }
    };

    void fetchCuratedLists();
  }, []);

  const handleShowDetails = async (media: MediaItem) => {
    showModal("discover-details", {
      id: Number(media.id),
      type: media.type === "movie" ? "movie" : "show",
    });
  };

  const handleBack = () => {
    const backUrl = getDiscoverBackUrl(lastView);
    if (backUrl && lastView) {
      navigate(backUrl);
      requestAnimationFrame(() => {
        window.scrollTo(0, lastView.scrollPosition);
      });
      return;
    }

    if (lastView) {
      navigate("/discover");
      return;
    }

    navigate(-1);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  return (
    <SubPageLayout>
      <Helmet>
        <style type="text/css">{`
            html, body {
              scrollbar-width: none;
              -ms-overflow-style: none;
            }
          `}</style>
      </Helmet>

      <WideContainer>
        <div className="flex items-center justify-between gap-8">
          <Heading1 className="text-2xl font-bold text-white">
            {t("discover.allLists")}
          </Heading1>
        </div>
        <div className="flex items-center gap-4 pb-8">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center text-white hover:text-gray-300 transition-colors"
          >
            <Icon className="text-xl" icon={Icons.ARROW_LEFT} />
            <span className="ml-2">{t("discover.page.back")}</span>
          </button>
        </div>
      </WideContainer>
      <WideContainer ultraWide>
        <div className="relative">
          <LazyMediaCarousel
            content={{ type: "latest", fallback: "nowPlaying" }}
            isTVShow={false}
            carouselRefs={carouselRefs}
            onShowDetails={handleShowDetails}
            priority
          />
        </div>

        <div className="relative">
          <LazyMediaCarousel
            content={{ type: "latest4k", fallback: "topRated" }}
            isTVShow={false}
            carouselRefs={carouselRefs}
            onShowDetails={handleShowDetails}
            priority
          />
        </div>

        {conf().USE_TRAKT
          ? visibleCuratedLists.map((list) => (
              <div key={list.listSlug}>
                <div className="flex items-center justify-between ml-2 md:ml-8 mt-2">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-4">
                      <h2 className="pl-5 text-2xl font-bold cursor-default text-balance text-white md:text-2xl">
                        {list.listName}
                      </h2>
                    </div>
                  </div>
                </div>
                <div className="relative overflow-hidden carousel-container md:pb-4">
                  <div
                    className="grid grid-flow-col auto-cols-max gap-4 pt-0 overflow-x-scroll scrollbar-none rounded-xl overflow-y-hidden md:pl-8 md:pr-8"
                    ref={(el) => {
                      carouselRefs.current[list.listSlug] = el;
                    }}
                    onWheel={handleWheel}
                  >
                    <div className="md:w-12" />
                    {movieDetails[list.listSlug]?.map(
                      (movie: TMDBMovieData) => (
                        <div
                          key={movie.id}
                          className="relative mt-4 group cursor-pointer user-select-none rounded-xl p-2 bg-transparent transition-colors duration-300 w-[10rem] md:w-[11.5rem] h-auto"
                        >
                          <MediaCard
                            linkable
                            media={{
                              id: movie.id.toString(),
                              title: movie.title,
                              poster: movie.poster_path
                                ? `https://image.tmdb.org/t/p/w342${movie.poster_path}`
                                : "/placeholder.png",
                              type: "movie",
                              year: movie.release_date
                                ? parseInt(movie.release_date.split("-")[0], 10)
                                : undefined,
                            }}
                            onShowDetails={handleShowDetails}
                          />
                        </div>
                      ),
                    )}
                    <div className="md:w-12" />
                  </div>
                  {!isMobile ? (
                    <CarouselNavButtons
                      categorySlug={list.listSlug}
                      carouselRefs={carouselRefs}
                    />
                  ) : null}
                </div>
              </div>
            ))
          : null}

        <div className="relative">
          <LazyMediaCarousel
            content={{ type: "popular" }}
            isTVShow={false}
            carouselRefs={carouselRefs}
            onShowDetails={handleShowDetails}
          />
        </div>

        <div className="relative">
          <LazyMediaCarousel
            content={{ type: "trending" }}
            isTVShow={false}
            carouselRefs={carouselRefs}
            onShowDetails={handleShowDetails}
          />
        </div>
      </WideContainer>
    </SubPageLayout>
  );
}
