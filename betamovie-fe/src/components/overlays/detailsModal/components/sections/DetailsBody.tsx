import classNames from "classnames";
import { t } from "i18next";

import { Button } from "@/components/buttons/Button";
import { IconPatch } from "@/components/buttons/IconPatch";
import { GroupDropdown } from "@/components/form/GroupDropdown";
import { Icon, Icons } from "@/components/Icon";
import { MediaBookmarkButton } from "@/components/media/MediaBookmark";
import { useBookmarkStore } from "@/stores/bookmarks";

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
}: DetailsBodyProps) {
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

  return (
    <div className="space-y-4">
      {/* TMDB Rating and Year/Seasons */}
      <div className="flex flex-wrap items-center gap-2 text-sm text-white/80">
        {/* Ratings Group */}
        <div className="flex items-center gap-2">
          {voteAverage && (
            <div className="flex items-center gap-1">
              <Icon icon={Icons.TMDB} />
              <span>{voteAverage.toFixed(1)}</span>
              {voteCount && (
                <span className="text-white/60">
                  ({voteCount.toLocaleString()})
                </span>
              )}
            </div>
          )}
          {imdbData?.rating && (
            <>
              <span className="text-white/60">•</span>
              <div className="flex items-center gap-1">
                <Icon icon={Icons.IMDB} className="text-yellow-400" />
                <span>{imdbData.rating.toFixed(1)}</span>
                {imdbData.votes && (
                  <span className="text-white/60">
                    ({imdbData.votes.toLocaleString()})
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Release Date and Seasons Group */}
        {(releaseDate || seasons) && (
          <div className="flex items-center gap-2">
            {releaseDate && (
              <>
                <span className="text-white/60">•</span>
                <span>{formatDate(releaseDate)}</span>
              </>
            )}
            {seasons && (
              <>
                <span className="text-white/60">•</span>
                <span>
                  {seasons} {t("details.seasons")}
                </span>
              </>
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
