import classNames from "classnames";
import { t } from "i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/buttons/Button";
import { Dropdown } from "@/components/form/Dropdown";
import { Icon, Icons } from "@/components/Icon";
import { Modal, ModalCard, useModal } from "@/components/overlays/Modal";
import { hasAired } from "@/components/player/utils/aired";
import { useBookmarkStore } from "@/stores/bookmarks";
import { getProgressPercentage, useProgressStore } from "@/stores/progress";
import { measureInlineExpandableText } from "@/utils/inlineExpandText";
import { formatSeasonTitle } from "@/utils/season";
import { formatDateDDMMYY } from "@/utils/timestamp";

import { EpisodeCarouselProps } from "../../types";

const EMPTY_ARRAY: string[] = [];
const EPISODE_GROUP_SIZE = 100;

interface EpisodeGroup {
  index: number;
  label: string;
}

function createEpisodeGroups(episodes: EpisodeCarouselProps["episodes"]) {
  const groups: EpisodeGroup[] = [];

  for (let index = 0; index < episodes.length; index += EPISODE_GROUP_SIZE) {
    const groupEpisodes = episodes.slice(index, index + EPISODE_GROUP_SIZE);
    if (groupEpisodes.length === 0) continue;

    groups.push({
      index: Math.floor(index / EPISODE_GROUP_SIZE),
      label: `${groupEpisodes[0].episode_number}-${groupEpisodes[groupEpisodes.length - 1].episode_number}`,
    });
  }

  return groups;
}

export function EpisodeCarousel({
  episodes,
  showProgress,
  progress,
  selectedSeason,
  onSeasonChange,
  seasons,
  mediaId,
  mediaTitle,
  mediaPosterUrl,
  totalEpisodes,
  boundaryRef,
}: EpisodeCarouselProps) {
  const [showEpisodeMenu, setShowEpisodeMenu] = useState(false);
  const [customSeason, setCustomSeason] = useState("");
  const [customEpisode, setCustomEpisode] = useState("");
  const [SeasonWatched, setSeasonWatched] = useState(false);
  const [expandedEpisodes, setExpandedEpisodes] = useState<{
    [key: number]: boolean;
  }>({});
  const [truncatedEpisodes, setTruncatedEpisodes] = useState<{
    [key: number]: boolean;
  }>({});
  const [collapsedEpisodeTexts, setCollapsedEpisodeTexts] = useState<{
    [key: number]: string;
  }>({});
  const [showFavorites, setShowFavorites] = useState(false);
  const [favoriteEpisodes, setFavoriteEpisodes] = useState<any[]>([]);
  const [selectedEpisodeGroupIndex, setSelectedEpisodeGroupIndex] = useState(0);
  const episodeMenuRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const activeEpisodeRef = useRef<HTMLAnchorElement>(null);
  const descriptionRefs = useRef<{
    [key: number]: HTMLElement | null;
  }>({});
  const updateItem = useProgressStore((s) => s.updateItem);
  const confirmModal = useModal("season-watch-confirm");

  const hasGenericEpisodeTitle = (
    episodeName: string | null | undefined,
    episodeNumber: number,
  ) => {
    if (!episodeName) return true;
    const normalizedName = episodeName.trim().toLowerCase();
    return (
      normalizedName === `episode ${episodeNumber}` ||
      normalizedName === `ep ${episodeNumber}`
    );
  };

  const handleScroll = (direction: "left" | "right") => {
    if (!carouselRef.current) return;

    const cardWidth = 256; // w-64 in pixels
    const cardSpacing = 16; // space-x-4 in pixels
    const scrollAmount = (cardWidth + cardSpacing) * 2;

    const newScrollPosition =
      carouselRef.current.scrollLeft +
      (direction === "left" ? -scrollAmount : scrollAmount);

    carouselRef.current.scrollTo({
      left: newScrollPosition,
      behavior: "smooth",
    });
  };

  // Function to generate the episode URL
  const getEpisodeUrl = (episode: any) => {
    const targetSeasonNumber = showFavorites
      ? episode.season_number
      : selectedSeason;
    const season = seasons.find((s) => s.season_number === targetSeasonNumber);

    if (!season || !mediaId || !mediaTitle) return "#";

    // Create the URL in the format: /media/tmdb-tv-{showId}-{showName}/{seasonId}/{episodeId}
    return `/media/tmdb-tv-${mediaId}-${mediaTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/${season.id}/${episode.id}`;
  };

  // Add click outside handler for episode menu
  useEffect(() => {
    if (!showEpisodeMenu) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        episodeMenuRef.current &&
        !episodeMenuRef.current.contains(event.target as Node)
      ) {
        setShowEpisodeMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showEpisodeMenu]);

  const handleCustomNavigation = () => {
    const season = parseInt(customSeason, 10);
    const episode = parseInt(customEpisode, 10);

    if (
      Number.isNaN(season) ||
      Number.isNaN(episode) ||
      !mediaId ||
      !mediaTitle
    )
      return;

    // Find the season
    const seasonData = seasons.find((s) => s.season_number === season);
    if (!seasonData) return;

    // Find the episode in the current season's episodes
    const episodeData = episodes.find(
      (e) => e.season_number === season && e.episode_number === episode,
    );

    if (!episodeData) {
      console.error(
        "No episode data found for season:",
        season,
        "episode:",
        episode,
      );
      return;
    }

    // Navigate to the episode using the same URL format as getEpisodeUrl
    const url = `/media/tmdb-tv-${mediaId}-${mediaTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/${seasonData.id}/${episodeData.id}`;
    window.location.href = url;
    setShowEpisodeMenu(false);
  };

  const toggleWatchStatus = (episodeId: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (mediaId) {
      const episode = episodes.find((ep) => ep.id === episodeId);
      if (episode) {
        const seasonData = seasons.find(
          (s) => s.season_number === episode.season_number,
        );
        if (!seasonData) return;

        // Check if the episode is already watched
        const episodeProgress =
          progress[mediaId.toString()]?.episodes?.[episodeId];
        const percentage = episodeProgress
          ? getProgressPercentage(
              episodeProgress.progress.watched,
              episodeProgress.progress.duration,
            )
          : 0;

        // If watched (>90%), reset to 0%, otherwise set to 100%
        const isWatched = percentage > 90;
        const shouldMarkWatched = !isWatched;

        // Get the poster URL from the mediaPosterUrl prop
        const posterUrl = mediaPosterUrl;

        // Update progress
        updateItem({
          meta: {
            tmdbId: mediaId.toString(),
            title: mediaTitle || "",
            type: "show",
            releaseYear: new Date().getFullYear(),
            poster: posterUrl,
            episode: {
              tmdbId: episodeId.toString(),
              number: episode.episode_number,
              title: episode.name || "",
            },
            season: {
              tmdbId: seasonData.id.toString(),
              number: episode.season_number,
              title: seasonData.name || "",
            },
          },
          progress: {
            watched: shouldMarkWatched ? 60 : 0, // 60 seconds (100%) for watched, 0 for unwatched
            duration: 60,
          },
        });
      }
    }
  };

  const toggleFavoriteEpisode = useBookmarkStore(
    (s) => s.toggleFavoriteEpisode,
  );
  const bookmarks = useBookmarkStore((s) => s.bookmarks);
  const activeEpisodeId = showProgress?.episode?.id ?? null;

  const toggleFavoriteStatus = (episodeId: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (mediaId) {
      toggleFavoriteEpisode(mediaId.toString(), episodeId.toString(), {
        title: mediaTitle || "",
        poster: mediaPosterUrl,
        year: new Date().getFullYear(), // We don't have year in this component
      });
    }
  };

  // Toggle whole season watch status
  const toggleSeasonWatchStatus = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    confirmModal.show();
  };

  const handleCancel = () => {
    confirmModal.hide();
  };

  const currentSeasonEpisodes = useMemo(
    () => episodes.filter((ep) => ep.season_number === selectedSeason),
    [episodes, selectedSeason],
  );
  const episodeGroups = useMemo(
    () => (showFavorites ? [] : createEpisodeGroups(currentSeasonEpisodes)),
    [currentSeasonEpisodes, showFavorites],
  );
  const shouldGroupEpisodes = episodeGroups.length > 1;
  const visibleSeasonEpisodes = useMemo(() => {
    if (!shouldGroupEpisodes) return currentSeasonEpisodes;

    const startIndex = selectedEpisodeGroupIndex * EPISODE_GROUP_SIZE;
    return currentSeasonEpisodes.slice(
      startIndex,
      startIndex + EPISODE_GROUP_SIZE,
    );
  }, [currentSeasonEpisodes, selectedEpisodeGroupIndex, shouldGroupEpisodes]);
  const displayedEpisodes = showFavorites
    ? favoriteEpisodes
    : visibleSeasonEpisodes;

  // Get favorite episodes for this show
  const favoriteEpisodeIds = useBookmarkStore((s) =>
    mediaId
      ? (s.bookmarks[mediaId.toString()]?.favoriteEpisodes ?? EMPTY_ARRAY)
      : EMPTY_ARRAY,
  );

  // Calculate watched episodes count and percentage
  const watchedStats = useMemo(() => {
    if (!mediaId || !totalEpisodes) return { watched: 0, percentage: 0 };

    let watchedCount = 0;
    episodes.forEach((episode) => {
      const episodeProgress =
        progress[mediaId.toString()]?.episodes?.[episode.id];
      const percentage = episodeProgress
        ? getProgressPercentage(
            episodeProgress.progress.watched,
            episodeProgress.progress.duration,
          )
        : 0;
      if (percentage > 90) {
        watchedCount += 1;
      }
    });

    const percentage = Math.round((watchedCount / totalEpisodes) * 100);

    return { watched: watchedCount, percentage };
  }, [episodes, progress, mediaId, totalEpisodes]);

  // Load favorite episodes when favorites is selected
  useEffect(() => {
    if (showFavorites && mediaId && favoriteEpisodeIds.length > 0) {
      const favoriteEpisodesData = episodes.filter((ep) =>
        favoriteEpisodeIds.includes(ep.id.toString()),
      );
      setFavoriteEpisodes(favoriteEpisodesData);
    } else {
      setFavoriteEpisodes([]);
    }
  }, [showFavorites, mediaId, favoriteEpisodeIds, episodes]);

  // Handle season/favorites selection
  const handleSeasonOrFavoritesChange = (item: {
    id: string;
    name: string;
  }) => {
    if (item.id === "favorites") {
      setShowFavorites(true);
      onSeasonChange(-1); // Use -1 to indicate favorites
    } else {
      setShowFavorites(false);
      onSeasonChange(Number(item.id));
    }
  };

  useEffect(() => {
    setSelectedEpisodeGroupIndex(0);
  }, [selectedSeason, showFavorites]);

  useEffect(() => {
    if (!shouldGroupEpisodes) {
      setSelectedEpisodeGroupIndex(0);
      return;
    }

    const activeEpisodeIndex = currentSeasonEpisodes.findIndex(
      (episode) => episode.id.toString() === activeEpisodeId,
    );
    const maxGroupIndex = episodeGroups.length - 1;

    setSelectedEpisodeGroupIndex((currentIndex) => {
      if (activeEpisodeIndex >= 0) {
        return Math.floor(activeEpisodeIndex / EPISODE_GROUP_SIZE);
      }

      return currentIndex > maxGroupIndex ? maxGroupIndex : currentIndex;
    });
  }, [
    currentSeasonEpisodes,
    episodeGroups.length,
    shouldGroupEpisodes,
    activeEpisodeId,
  ]);

  const handleConfirm = (event: React.MouseEvent) => {
    try {
      const episodeWatchedStatus: boolean[] = [];
      currentSeasonEpisodes.forEach((episode: any) => {
        const episodeProgress =
          progress[mediaId?.toString() ?? ""]?.episodes?.[episode.id];
        const percentage = episodeProgress
          ? getProgressPercentage(
              episodeProgress.progress.watched,
              episodeProgress.progress.duration,
            )
          : 0;
        const isAired = hasAired(episode.air_date);
        const isWatched = percentage > 90;
        if (isAired && !isWatched) {
          episodeWatchedStatus.push(isWatched);
        }
      });

      const hasUnwatched = episodeWatchedStatus.length >= 1;

      currentSeasonEpisodes.forEach((episode: any) => {
        const episodeProgress =
          progress[mediaId?.toString() ?? ""]?.episodes?.[episode.id];
        const percentage = episodeProgress
          ? getProgressPercentage(
              episodeProgress.progress.watched,
              episodeProgress.progress.duration,
            )
          : 0;
        const isAired = hasAired(episode.air_date);
        const isWatched = percentage > 90;
        if (hasUnwatched && isAired && !isWatched) {
          toggleWatchStatus(episode.id, event); // Mark unwatched as watched
        } else if (!hasUnwatched && isAired && isWatched) {
          toggleWatchStatus(episode.id, event); // Mark watched as unwatched
        }
      });

      confirmModal.hide();
    } catch (error) {
      console.error("Error in handleConfirm:", error);
      confirmModal.hide();
    }
  };

  const toggleEpisodeExpansion = (
    episodeId: number,
    event: React.MouseEvent,
  ) => {
    event.preventDefault();
    setExpandedEpisodes((prev) => ({
      ...prev,
      [episodeId]: !prev[episodeId],
    }));
  };

  // Add a new effect to reset states when season changes
  useEffect(() => {
    setExpandedEpisodes({});
    setTruncatedEpisodes({});
    setCollapsedEpisodeTexts({});
  }, [selectedSeason, selectedEpisodeGroupIndex, showFavorites]);

  // Check truncation after render and when expanded state changes
  useEffect(() => {
    const checkTruncation = () => {
      const newTruncatedState: { [key: number]: boolean } = {};
      const newCollapsedTextState: { [key: number]: string } = {};
      displayedEpisodes.forEach((episode) => {
        if (expandedEpisodes[episode.id] || !episode.overview) return;

        const element = descriptionRefs.current[episode.id];
        if (!element) return;

        const result = measureInlineExpandableText(
          element,
          episode.overview,
          t("player.menus.episodes.showMore"),
        );
        newTruncatedState[episode.id] = result.isTruncated;
        newCollapsedTextState[episode.id] = result.text;
      });
      setTruncatedEpisodes(newTruncatedState);
      setCollapsedEpisodeTexts(newCollapsedTextState);
    };

    checkTruncation();

    // Wait for the transition to complete
    const timeoutId = setTimeout(checkTruncation, 250);

    // Also check when window is resized
    const handleResize = () => {
      checkTruncation();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", handleResize);
    };
  }, [displayedEpisodes, expandedEpisodes]);

  useEffect(() => {
    if (!carouselRef.current) return;

    if (activeEpisodeRef.current) {
      const containerLeft = carouselRef.current.getBoundingClientRect().left;
      const containerWidth = carouselRef.current.clientWidth;
      const elementLeft = activeEpisodeRef.current.getBoundingClientRect().left;
      const elementWidth = activeEpisodeRef.current.clientWidth;

      const scrollPosition =
        elementLeft - containerLeft - containerWidth / 2 + elementWidth / 2;

      carouselRef.current.scrollTo({
        left: carouselRef.current.scrollLeft + scrollPosition,
        behavior: "smooth",
      });
      return;
    }

    carouselRef.current.scrollTo({
      left: 0,
      behavior: "smooth",
    });
  }, [
    activeEpisodeId,
    displayedEpisodes,
    selectedEpisodeGroupIndex,
    selectedSeason,
    showFavorites,
  ]);

  useEffect(() => {
    const episodeWatchedStatus: boolean[] = [];

    currentSeasonEpisodes.forEach((episode: any) => {
      const episodeProgress =
        progress[mediaId?.toString() ?? ""]?.episodes?.[episode.id];
      const percentage = episodeProgress
        ? getProgressPercentage(
            episodeProgress.progress.watched,
            episodeProgress.progress.duration,
          )
        : 0;
      const isAired = hasAired(episode.air_date);
      const isWatched = percentage > 90;

      if (isAired && !isWatched) {
        episodeWatchedStatus.push(isWatched);
      }
    });

    if (episodeWatchedStatus.length >= 1) {
      setSeasonWatched(true); // If no episodes are watched, we want to mark all as watched
    } else {
      setSeasonWatched(false); // if all episodes are watched, we want to mark all as unwatched
    }
  }, [currentSeasonEpisodes, episodes, mediaId, progress]);

  return (
    <div className="mt-6 md:mt-0">
      {/* Season Selector */}
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-3">
          <h4 className="text-lg font-semibold text-white">
            {t("details.episodes")}
          </h4>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowEpisodeMenu(!showEpisodeMenu)}
              className="p-2 rounded-full hover:bg-white/10 transition-colors"
              title={t("details.goToEpisode")}
            >
              <Icon icon={Icons.SEARCH} className="text-white/80" />
            </button>

            {/* Episode Selection Menu */}
            {showEpisodeMenu && (
              <div
                ref={episodeMenuRef}
                className="absolute top-full left-0 mt-2 p-4 bg-background-main rounded-xl shadow-lg  z-50 min-w-[250px]"
              >
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-white/80 mb-1">
                      {t("details.season")}
                    </label>
                    <input
                      type="number"
                      value={customSeason}
                      onChange={(e) => setCustomSeason(e.target.value)}
                      min="0"
                      max={Math.max(
                        0,
                        ...seasons.map((season) => season.season_number),
                      )}
                      className="w-full px-3 py-2 bg-white/5 rounded-xl text-white focus:outline-none focus:border-white/30"
                      placeholder={t("details.season")}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-white/80 mb-1">
                      {t("details.episode")}
                    </label>
                    <input
                      type="number"
                      value={customEpisode}
                      onChange={(e) => setCustomEpisode(e.target.value)}
                      min="1"
                      className="w-full px-3 py-2 bg-white/5 rounded-xl text-white focus:outline-none focus:border-white/30"
                      placeholder={t("details.episode")}
                    />
                  </div>
                  <Button
                    theme="purple"
                    onClick={handleCustomNavigation}
                    className="w-full px-4 py-2"
                  >
                    {t("details.play")}
                  </Button>
                </div>
              </div>
            )}
          </div>
          {totalEpisodes && (
            <span className="text-xs md:text-sm text-white/70">
              {t("details.watched", {
                watched: watchedStats.watched,
                total: totalEpisodes,
                percentage: watchedStats.percentage,
              })}
            </span>
          )}
          {!showFavorites && shouldGroupEpisodes && (
            <Dropdown
              className="my-0"
              menuClassName="max-h-72 whitespace-nowrap"
              boundaryRef={boundaryRef}
              options={episodeGroups.map((group) => ({
                id: group.index.toString(),
                name: group.label,
              }))}
              selectedItem={{
                id: selectedEpisodeGroupIndex.toString(),
                name:
                  episodeGroups.find(
                    (group) => group.index === selectedEpisodeGroupIndex,
                  )?.label ?? episodeGroups[0].label,
              }}
              setSelectedItem={(item) =>
                setSelectedEpisodeGroupIndex(Number(item.id))
              }
            />
          )}
        </div>

        {/* Season Watched Confirmation */}
        <div className="flex items-center justify-between gap-2">
          <Modal id={confirmModal.id}>
            <ModalCard>
              <h3 className="text-lg font-semibold text-white mb-4">
                {SeasonWatched
                  ? t("media.seasonWatched")
                  : t("media.seasonUnwatched")}
              </h3>
              <div className="flex justify-end gap-2">
                <Button theme="secondary" onClick={handleCancel}>
                  {t("actions.cancel")}
                </Button>
                <Button theme="purple" onClick={handleConfirm}>
                  {t("actions.confirm")}
                </Button>
              </div>
            </ModalCard>
          </Modal>
          {!showFavorites && (
            <button
              type="button"
              onClick={(e) => toggleSeasonWatchStatus(e)}
              className="p-1.5 bg-dropdown-background hover:bg-dropdown-hoverBackground transition-colors rounded-full"
              title={t("Mark season as watched")}
            >
              <Icon
                icon={SeasonWatched ? Icons.EYE : Icons.EYE_SLASH}
                className="h-5 w-5 text-white"
              />
            </button>
          )}

          <Dropdown
            preventWrap
            boundaryRef={boundaryRef}
            options={[
              // Add favorites option if there are favorite episodes
              ...(favoriteEpisodeIds.length > 0
                ? [
                    {
                      id: "favorites",
                      name: `${t("player.menus.episodes.favorites")} (${favoriteEpisodeIds.length})`,
                    },
                  ]
                : []),
              // Add regular seasons
              ...seasons.map((season) => ({
                id: season.season_number.toString(),
                name: formatSeasonTitle(
                  season.name,
                  season.season_number,
                  t,
                  "season",
                ),
              })),
            ]}
            selectedItem={{
              id: showFavorites ? "favorites" : selectedSeason.toString(),
              name: showFavorites
                ? `${t("player.menus.episodes.favorites")} (${favoriteEpisodeIds.length})`
                : formatSeasonTitle(
                    seasons.find(
                      (season) => season.season_number === selectedSeason,
                    )?.name,
                    selectedSeason,
                    t,
                    "season",
                  ),
            }}
            setSelectedItem={handleSeasonOrFavoritesChange}
          />
        </div>
      </div>

      {/* Episodes Carousel */}
      <div className="relative">
        {/* Left scroll button */}
        <div className="absolute left-0 top-1/2 transform -translate-y-1/2 z-10 px-4 hidden lg:block">
          <button
            type="button"
            className="p-2 bg-black/80 hover:bg-video-context-hoverColor transition-colors rounded-full border border-video-context-border backdrop-blur-sm"
            onClick={() => handleScroll("left")}
          >
            <Icon icon={Icons.CHEVRON_LEFT} className="text-white/80" />
          </button>
        </div>

        <div
          ref={carouselRef}
          className="flex overflow-x-auto space-x-4 pb-4 pt-2 lg:px-12 scrollbar-hide carousel-container"
          style={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {/* Add padding before the first card */}
          <div className="flex-shrink-0 w-4" />
          {showFavorites && favoriteEpisodes.length === 0 ? (
            <div className="flex-shrink-0 w-full flex justify-center items-center p-8">
              <div className="text-center">
                <p className="text-white/80 mb-2">
                  {t("player.menus.episodes.noFavorites")}
                </p>
                <p className="text-sm text-white/60">
                  {t("player.menus.episodes.favoritesDescription")}
                </p>
              </div>
            </div>
          ) : (
            displayedEpisodes.map((episode) => {
              const isActive = activeEpisodeId === episode.id.toString();
              const episodeProgress =
                progress[mediaId?.toString() ?? ""]?.episodes?.[episode.id];
              const percentage = episodeProgress
                ? getProgressPercentage(
                    episodeProgress.progress.watched,
                    episodeProgress.progress.duration,
                  )
                : 0;
              const isAired = hasAired(episode.air_date);
              const isExpanded = expandedEpisodes[episode.id];
              const isWatched = percentage > 90;
              const isFavorited = mediaId
                ? (bookmarks[mediaId.toString()]?.favoriteEpisodes?.includes(
                    episode.id.toString(),
                  ) ?? false)
                : false;
              const formattedReleaseDate = formatDateDDMMYY(episode.air_date);
              const episodeTitle = hasGenericEpisodeTitle(
                episode.name,
                episode.episode_number,
              )
                ? t("details.episodeNumber", {
                    number: episode.episode_number,
                  })
                : episode.name;
              const episodeBadgeLabel = showFavorites
                ? t("media.episodeDisplay", {
                    season: episode.season_number,
                    episode: episode.episode_number,
                  })
                : t("player.menus.episodes.episodeBadge", {
                    episode: episode.episode_number,
                  });

              return (
                <Link
                  key={episode.id}
                  to={getEpisodeUrl(episode)}
                  ref={isActive ? activeEpisodeRef : null}
                  className={classNames(
                    "flex-shrink-0 transition-all duration-200 relative cursor-pointer hover:scale-95 rounded-lg overflow-hidden",
                    isActive
                      ? "bg-video-context-hoverColor/50 hover:bg-white/5"
                      : "hover:bg-white/5",
                    !isAired ? "opacity-50" : "",
                    isExpanded ? "w-[32rem]" : "w-52 md:w-64",
                    "h-[280px]", // Fixed height for all states
                  )}
                >
                  {/* Thumbnail */}
                  {!isExpanded && (
                    <div className="relative h-[158px] w-full bg-video-context-hoverColor">
                      {episode.still_path ? (
                        <img
                          src={`https://image.tmdb.org/t/p/w300${episode.still_path}`}
                          alt={episode.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-black bg-opacity-50">
                          <Icon
                            icon={Icons.FILM}
                            className="text-video-context-type-main opacity-50 text-3xl"
                          />
                        </div>
                      )}

                      {/* Episode Number Badge */}
                      <div className="absolute top-2 left-2 flex items-center space-x-2">
                        <span className="p-0.5 px-2 rounded inline bg-video-context-hoverColor bg-opacity-80 text-video-context-type-main text-sm">
                          {episodeBadgeLabel}
                        </span>
                        {!isAired && (
                          <span className="bg-video-context-hoverColor/50 text-video-context-type-main/80 text-sm px-1 py-0.5 rounded-md">
                            {t("media.unreleased")}
                          </span>
                        )}
                      </div>

                      {/* Mark as watched and favorite buttons */}
                      {isAired && (
                        <div className="absolute top-2 right-2 flex gap-1">
                          <button
                            type="button"
                            onClick={(e) => toggleFavoriteStatus(episode.id, e)}
                            className="p-1.5 bg-black/50 rounded-full hover:bg-black/80 transition-colors"
                            title={t("player.menus.episodes.markAsFavorite")}
                          >
                            <Icon
                              icon={
                                isFavorited
                                  ? Icons.BOOKMARK
                                  : Icons.BOOKMARK_OUTLINE
                              }
                              className="h-8 w-8 text-white/80"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => toggleWatchStatus(episode.id, e)}
                            className="p-1.5 bg-black/50 rounded-full hover:bg-black/80 transition-colors"
                            title={
                              isWatched
                                ? t("player.menus.episodes.markAsUnwatched")
                                : t("player.menus.episodes.markAsWatched")
                            }
                          >
                            <Icon
                              icon={isWatched ? Icons.EYE_SLASH : Icons.EYE}
                              className="h-4 w-4 text-white/80"
                            />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Content */}
                  <div
                    className={classNames(
                      "p-3",
                      isExpanded ? "h-full" : "h-[122px]",
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <h3 className="font-bold text-white line-clamp-1">
                        {episodeTitle}
                      </h3>
                      {isExpanded && isAired && (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={(e) => toggleFavoriteStatus(episode.id, e)}
                            className="p-1.5 rounded-full hover:bg-white/20 transition-colors"
                            title={t("player.menus.episodes.markAsFavorite")}
                          >
                            <Icon
                              icon={
                                isFavorited
                                  ? Icons.BOOKMARK
                                  : Icons.BOOKMARK_OUTLINE
                              }
                              className="h-8 w-8 text-white/80"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => toggleWatchStatus(episode.id, e)}
                            className="p-1.5 rounded-full hover:bg-white/20 transition-colors"
                            title={
                              isWatched
                                ? t("player.menus.episodes.markAsUnwatched")
                                : t("player.menus.episodes.markAsWatched")
                            }
                          >
                            <Icon
                              icon={isWatched ? Icons.EYE_SLASH : Icons.EYE}
                              className="h-4 w-4 text-white/80"
                            />
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-white/60 mt-1">
                      {formattedReleaseDate
                        ? t("details.episodeReleaseDate", {
                            date: formattedReleaseDate,
                          })
                        : t("details.episodeReleaseDateUnknown")}
                    </p>
                    {episode.overview && (
                      <div className="relative">
                        {!isExpanded ? (
                          <div
                            ref={(el) => {
                              descriptionRefs.current[episode.id] = el;
                            }}
                            className="mt-1.5 max-h-10 overflow-hidden text-sm leading-5 text-white/80 transition-all duration-200"
                          >
                            <span>
                              {truncatedEpisodes[episode.id]
                                ? collapsedEpisodeTexts[episode.id]
                                : episode.overview}
                            </span>
                            {truncatedEpisodes[episode.id] ? (
                              <>
                                ...{" "}
                                <button
                                  type="button"
                                  onClick={(e) =>
                                    toggleEpisodeExpansion(episode.id, e)
                                  }
                                  className="inline text-sm leading-5 text-white/60 transition-colors duration-200 hover:text-white"
                                >
                                  {t("player.menus.episodes.showMore")}
                                </button>
                              </>
                            ) : null}
                          </div>
                        ) : (
                          <p
                            ref={(el) => {
                              descriptionRefs.current[episode.id] = el;
                            }}
                            className="text-sm text-white/80 mt-1.5 max-h-[200px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent pr-2 transition-all duration-200"
                          >
                            {episode.overview}
                          </p>
                        )}
                        {isExpanded && (
                          <button
                            type="button"
                            onClick={(e) =>
                              toggleEpisodeExpansion(episode.id, e)
                            }
                            className="mt-2 text-sm text-white/60 hover:text-white transition-opacity duration-200 opacity-0 animate-fade-in"
                          >
                            {t("player.menus.episodes.showLess")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Progress Bar */}
                  {percentage > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-progress-background/25">
                      <div
                        className="h-full bg-progress-filled"
                        style={{
                          width: `${percentage > 98 ? 100 : percentage}%`,
                        }}
                      />
                    </div>
                  )}
                </Link>
              );
            })
          )}

          {/* Add padding after the last card */}
          <div className="flex-shrink-0 w-4" />
        </div>

        {/* Right scroll button */}
        <div className="absolute right-0 top-1/2 transform -translate-y-1/2 z-10 px-4 hidden lg:block">
          <button
            type="button"
            className="p-2 bg-black/80 hover:bg-video-context-hoverColor transition-colors rounded-full border border-video-context-border backdrop-blur-sm"
            onClick={() => handleScroll("right")}
          >
            <Icon icon={Icons.CHEVRON_RIGHT} className="text-white/80" />
          </button>
        </div>
      </div>
    </div>
  );
}
