import classNames from "classnames";
import { useCallback, useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";

import {
  getMediaBackdrop,
  getMediaBaseDetails,
  getMediaDetailSupplemental,
  getMediaLogo,
  getMediaPoster,
} from "@/backend/metadata/tmdb";
import {
  TMDBContentTypes,
  TMDBMovieData,
  TMDBShowData,
} from "@/backend/metadata/types/tmdb";
import { IconPatch } from "@/components/buttons/IconPatch";
import { Icons } from "@/components/Icon";
import { Flare } from "@/components/utils/Flare";
import { useOverlayStack } from "@/stores/interface/overlayStack";

import { DetailsContent } from "./DetailsContent";
import { DetailsSkeleton } from "./DetailsSkeleton";
import { OverlayPortal } from "../../../OverlayDisplay";
import { DetailsModalProps } from "../../types";

export function DetailsModal({
  id,
  data: _data,
  minimal: _minimal,
}: DetailsModalProps) {
  // Player details modal should always be minimal (hide episode carousel and movie watch button)
  const minimal = _minimal || id === "player-details";
  const hideModal = useOverlayStack((state) => state.hideModal);
  const modalIndex = useOverlayStack((state) => state.modalStack.indexOf(id));
  const modalData = useOverlayStack((state) => state.modalData[id]);
  const [detailsData, setDetailsData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  const zIndex = modalIndex >= 0 ? 1000 + modalIndex : 999;

  const hide = useCallback(() => hideModal(id), [hideModal, id]);
  const isShown = modalIndex >= 0;
  const requestedId = modalData?.id ?? _data?.id;
  const requestedType = modalData?.type ?? _data?.type;

  // Only show modal if there's data to display
  const shouldShow = Boolean(isShown && requestedId && requestedType);

  useEffect(() => {
    let isCancelled = false;

    const fetchDetails = async () => {
      if (!requestedId || !requestedType) return;

      setIsLoading(true);
      try {
        const type =
          requestedType === "movie"
            ? TMDBContentTypes.MOVIE
            : TMDBContentTypes.TV;
        const basePromise = getMediaBaseDetails(requestedId.toString(), type);
        const supplementalPromise = getMediaDetailSupplemental(
          requestedId.toString(),
          type,
        );
        const logoPromise = getMediaLogo(requestedId.toString(), type);
        const supplementalAndLogoPromise = Promise.allSettled([
          supplementalPromise,
          logoPromise,
        ]);

        const details = await basePromise;

        if (isCancelled) return;

        const backdropUrl = getMediaBackdrop(details.backdrop_path);
        const posterUrl = getMediaPoster(details.poster_path);

        if (type === TMDBContentTypes.MOVIE) {
          const movieDetails = details as TMDBMovieData;
          setDetailsData({
            title: movieDetails.title,
            overview: movieDetails.overview,
            backdrop: backdropUrl,
            posterUrl,
            runtime: movieDetails.runtime,
            genres: movieDetails.genres,
            language: movieDetails.original_language,
            voteAverage: movieDetails.vote_average,
            voteCount: movieDetails.vote_count,
            releaseDate: movieDetails.release_date,
            rating: undefined,
            type: "movie",
            id: movieDetails.id,
            imdbId: undefined,
            logoUrl: undefined,
            collection: movieDetails.belongs_to_collection,
          });
        } else {
          const showDetails = details as TMDBShowData;
          setDetailsData({
            title: showDetails.name,
            overview: showDetails.overview,
            backdrop: backdropUrl,
            posterUrl,
            episodes: showDetails.number_of_episodes,
            seasons: showDetails.number_of_seasons,
            genres: showDetails.genres,
            language: showDetails.original_language,
            voteAverage: showDetails.vote_average,
            voteCount: showDetails.vote_count,
            releaseDate: showDetails.first_air_date,
            rating: undefined,
            type: "show",
            id: showDetails.id,
            imdbId: undefined,
            seasonData: {
              seasons: showDetails.seasons,
              episodes: [],
            },
            logoUrl: undefined,
          });
        }

        setIsLoading(false);

        void supplementalAndLogoPromise.then(
          ([supplementalResult, logoResult]) => {
            if (isCancelled) return;

            const supplemental =
              supplementalResult.status === "fulfilled"
                ? supplementalResult.value
                : undefined;
            const logoUrl =
              logoResult.status === "fulfilled" ? logoResult.value : undefined;

            if (type === TMDBContentTypes.MOVIE) {
              const movieSupplemental = supplemental as
                | Pick<TMDBMovieData, "external_ids" | "release_dates">
                | undefined;
              const rating = movieSupplemental?.release_dates?.results?.find(
                (r) => r.iso_3166_1 === "US",
              )?.release_dates?.[0]?.certification;
              const imdbId = movieSupplemental?.external_ids?.imdb_id;

              setDetailsData((current: any) =>
                current?.id === details.id && current.type === "movie"
                  ? { ...current, rating, imdbId, logoUrl }
                  : current,
              );
            } else {
              const showSupplemental = supplemental as
                | Pick<TMDBShowData, "external_ids" | "content_ratings">
                | undefined;
              const rating = showSupplemental?.content_ratings?.results?.find(
                (r) => r.iso_3166_1 === "US",
              )?.rating;
              const imdbId = showSupplemental?.external_ids?.imdb_id;

              setDetailsData((current: any) =>
                current?.id === details.id && current.type === "show"
                  ? { ...current, rating, imdbId, logoUrl }
                  : current,
              );
            }
          },
        );
      } catch (err) {
        if (!isCancelled) {
          console.error("Failed to fetch media details:", err);
          setIsLoading(false);
        }
      }
    };

    if (shouldShow) {
      void fetchDetails();
    }

    return () => {
      isCancelled = true;
    };
  }, [shouldShow, requestedId, requestedType]);

  useEffect(() => {
    if (!isShown) {
      setDetailsData(null);
    }
  }, [isShown]);

  useEffect(() => {
    if (isShown && !requestedId && !isLoading) {
      hide();
    }
  }, [isShown, requestedId, isLoading, hide]);

  return (
    <OverlayPortal
      darken
      close={hide}
      show={shouldShow}
      durationClass="duration-500"
      zIndex={zIndex}
    >
      <Helmet>
        <html data-no-scroll />
      </Helmet>
      <div className="flex absolute inset-0 items-center justify-center pt-safe">
        <Flare.Base
          className={classNames(
            "group -m-[0.705em] rounded-3xl bg-background-main",
            "max-h-[900px] max-w-[1200px]",
            "bg-mediaCard-hoverBackground/60 backdrop-filter backdrop-blur-lg shadow-lg overflow-hidden",
            "h-[97%] w-[95%]",
            "relative",
          )}
        >
          <div className="transition-transform duration-300 h-full relative">
            <Flare.Light
              flareSize={300}
              cssColorVar="--colors-mediaCard-hoverAccent"
              backgroundClass="bg-modal-background duration-100"
              className="rounded-3xl bg-background-main group-hover:opacity-100 transition-opacity duration-300"
            />
            <div className="absolute right-4 top-4 z-50 pointer-events-auto">
              <button
                type="button"
                className="text-s font-semibold text-type-secondary hover:text-white transition-transform hover:scale-95 select-none"
                onClick={hide}
              >
                <IconPatch icon={Icons.X} />
              </button>
            </div>
            <Flare.Child className="pointer-events-auto relative h-full overflow-y-auto scrollbar-none select-text">
              <div className="select-text">
                {isLoading || !detailsData ? (
                  <DetailsSkeleton />
                ) : (
                  <DetailsContent
                    key={`${detailsData.type}-${detailsData.id}`}
                    data={detailsData}
                    minimal={minimal}
                  />
                )}
              </div>
            </Flare.Child>
          </div>
        </Flare.Base>
      </div>
    </OverlayPortal>
  );
}
