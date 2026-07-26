import classNames from "classnames";
import { t } from "i18next";
import { useEffect, useState } from "react";

import { getReleaseDetails } from "@/backend/metadata/traktApi";
import type { TraktReleaseResponse } from "@/backend/metadata/types/trakt";
import { Button } from "@/components/buttons/Button";
import { IconPatch } from "@/components/buttons/IconPatch";
import { GroupDropdown } from "@/components/form/GroupDropdown";
import { Icon, Icons } from "@/components/Icon";
import { MediaBookmarkButton } from "@/components/media/MediaBookmark";
import {
  ReleaseQualityBadge,
  getReleaseQualityVariant,
} from "@/components/media/ReleaseQualityBadge";
import { conf } from "@/setup/config";
import { useBookmarkStore } from "@/stores/bookmarks";
import { formatCompactCount } from "@/utils/formatNumber";
import { getRTAudienceIcon, getRTIcon } from "@/utils/rottenTomatoes";

import { DetailsBodyProps } from "../../types";

export function DetailsBody({
  data,
  onPlayClick,
  onShareClick,
  showProgress,
  voteAverage,
  voteCount,
  releaseDate,
  seasons,
  imdbData,
  rtData,
  isLoadingImdb,
  isLoadingRt,
}: DetailsBodyProps) {
  const [releaseInfo, setReleaseInfo] = useState<TraktReleaseResponse | null>(
    null,
  );
  const addBookmarkWithGroups = useBookmarkStore(
    (s) => s.addBookmarkWithGroups,
  );

  const bookmarks = useBookmarkStore((s) => s.bookmarks);
  const currentGroups = bookmarks[data.id?.toString() ?? ""]?.group || [];

  const allGroups = Array.from(
    new Set(
      Object.values(bookmarks)
        .flatMap((b) => b.group || [])
        .filter(Boolean),
    ),
  ) as string[];

  const handleSelectGroups = (groups: string[]) => {
    if (!data.id) return;
    const meta = {
      tmdbId: data.id.toString(),
      title: data.title,
      type: data.type || "movie",
      releaseYear: data.releaseDate
        ? new Date(data.releaseDate).getFullYear()
        : 0,
      poster: data.posterUrl,
    };
    addBookmarkWithGroups(meta, groups);
  };

  const handleCreateGroup = (group: string) => {
    handleSelectGroups([...currentGroups, group]);
  };

  const handleRemoveGroup = (groupToRemove?: string) => {
    if (!data.id) return;
    const meta = {
      tmdbId: data.id.toString(),
      title: data.title,
      type: data.type || "movie",
      releaseYear: data.releaseDate
        ? new Date(data.releaseDate).getFullYear()
        : 0,
      poster: data.posterUrl,
    };
    if (groupToRemove) {
      const newGroups = currentGroups.filter((g) => g !== groupToRemove);
      addBookmarkWithGroups(meta, newGroups);
    } else {
      // Remove all groups
      addBookmarkWithGroups(meta, []);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return null;
    return new Date(dateString).getFullYear();
  };

  useEffect(() => {
    let isCancelled = false;

    const fetchReleaseInfo = async () => {
      if (!conf().USE_TRAKT || !data.id || data.type !== "movie") {
        setReleaseInfo(null);
        return;
      }

      try {
        const info = await getReleaseDetails(data.id.toString());
        if (!isCancelled) {
          setReleaseInfo(info);
        }
      } catch (error) {
        if (!isCancelled) {
          setReleaseInfo(null);
        }
        console.error("Failed to fetch release info:", error);
      }
    };

    void fetchReleaseInfo();

    return () => {
      isCancelled = true;
    };
  }, [data.id, data.type]);

  const qualityVariant =
    data.type === "movie" ? getReleaseQualityVariant(releaseInfo) : null;
  const inlineLoadingClass =
    "h-4 w-14 rounded bg-white/10 animate-pulse inline-block";
  const metadataItemClass = "flex items-center gap-1 whitespace-nowrap";
  const metadataCountClass = "text-[10px] text-white/60 sm:text-xs";
  const metadataSeparatorClass = "text-white/60";

  return (
    <div className="space-y-4">
      {/* TMDB Rating and Year/Seasons */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] text-white/80 sm:text-sm">
        {qualityVariant ? (
          <div className="flex items-center gap-2">
            <ReleaseQualityBadge variant={qualityVariant} />
            <span className={metadataSeparatorClass}>•</span>
          </div>
        ) : null}

        {/* Ratings Group */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          {typeof voteAverage === "number" && (
            <div className={metadataItemClass}>
              <Icon icon={Icons.TMDB} />
              <span>{voteAverage.toFixed(1)}</span>
              {typeof voteCount === "number" && (
                <span className={metadataCountClass}>
                  <span className="sm:hidden">
                    ({formatCompactCount(voteCount)})
                  </span>
                  <span className="hidden sm:inline">
                    ({voteCount.toLocaleString()})
                  </span>
                </span>
              )}
            </div>
          )}

          {(isLoadingImdb || imdbData) && (
            <div className={metadataItemClass}>
              <span className={metadataSeparatorClass}>•</span>
              <Icon icon={Icons.IMDB} className="text-yellow-400" />
              {isLoadingImdb ? (
                <span className={inlineLoadingClass} />
              ) : (
                <span>{imdbData?.rating.toFixed(1)}</span>
              )}
              {!isLoadingImdb && typeof imdbData?.votes === "number" && (
                <span className={metadataCountClass}>
                  <span className="sm:hidden">
                    ({formatCompactCount(imdbData.votes)})
                  </span>
                  <span className="hidden sm:inline">
                    ({imdbData.votes.toLocaleString()})
                  </span>
                </span>
              )}
            </div>
          )}

          {(isLoadingRt || rtData) && (
            <div className={metadataItemClass}>
              <span className={metadataSeparatorClass}>•</span>
              {rtData ? (
                <img
                  src={getRTIcon(rtData.tomatoIcon)}
                  alt="Tomatometer"
                  className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                />
              ) : (
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#fa320a]">
                  RT
                </span>
              )}
              {isLoadingRt ? (
                <span className={inlineLoadingClass} />
              ) : (
                <span>{rtData?.tomatoScore}%</span>
              )}
            </div>
          )}

          {(isLoadingRt || typeof rtData?.popcornScore === "number") && (
            <div className={metadataItemClass}>
              <span className={metadataSeparatorClass}>•</span>
              <img
                src={getRTAudienceIcon(rtData?.popcornIcon ?? "empty")}
                alt="Popcornmeter"
                className="h-3.5 w-3.5 sm:h-4 sm:w-4"
              />
              {isLoadingRt ? (
                <span className={inlineLoadingClass} />
              ) : (
                <span>{rtData?.popcornScore}%</span>
              )}
            </div>
          )}
        </div>

        {/* Release Date and Seasons Group */}
        {(releaseDate || seasons) && (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            {releaseDate && (
              <div className={metadataItemClass}>
                <span className={metadataSeparatorClass}>•</span>
                <span>{formatDate(releaseDate)}</span>
              </div>
            )}
            {seasons && (
              <div className={metadataItemClass}>
                <span className={metadataSeparatorClass}>•</span>
                <span>
                  {seasons} {t("details.seasons")}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            onClick={onPlayClick}
            theme="purple"
            className={classNames(
              "flex-1 sm:flex-initial sm:w-auto",
              "gap-2 h-12 rounded-lg px-4 py-2 my-1 transition-transform hover:scale-105 duration-100",
              "text-md text-white flex items-center justify-center",
            )}
          >
            <Icon icon={Icons.PLAY} className="text-white" />
            <span className="text-white text-sm pr-1">
              {showProgress &&
              data.type === "show" &&
              showProgress.season &&
              showProgress.episode
                ? `${t("details.resume")} S${showProgress.season.number}:E${
                    showProgress.episode.number
                  }`
                : data.type === "movie"
                  ? !data.releaseDate || new Date(data.releaseDate) > new Date()
                    ? t("media.unreleased")
                    : showProgress
                      ? t("details.resume")
                      : t("details.play")
                  : showProgress
                    ? t("details.resume")
                    : t("details.play")}
            </span>
          </Button>
          <div className="flex items-center gap-1 flex-shrink-0">
            <MediaBookmarkButton
              media={{
                id: data.id?.toString() || "",
                title: data.title,
                year: data.releaseDate
                  ? new Date(data.releaseDate).getFullYear()
                  : undefined,
                poster: data.posterUrl,
                type: data.type || "movie",
              }}
            />
            <button
              type="button"
              onClick={onShareClick}
              className="p-2 opacity-75 transition-opacity duration-300 hover:scale-110 hover:cursor-pointer hover:opacity-95"
              title="Share"
            >
              <IconPatch
                icon={Icons.IOS_SHARE}
                className="transition-transform duration-300 hover:scale-110 hover:cursor-pointer"
              />
            </button>
          </div>
        </div>

        {/* Group Dropdown */}
        <GroupDropdown
          groups={allGroups}
          currentGroups={currentGroups}
          onSelectGroups={handleSelectGroups}
          onCreateGroup={handleCreateGroup}
          onRemoveGroup={handleRemoveGroup}
        />
      </div>
    </div>
  );
}
