import { t } from "i18next";

import { Icon, Icons } from "@/components/Icon";
import { getRTAudienceIcon, getRTIcon } from "@/utils/rottenTomatoes";

import { DetailsRatingsProps } from "../../types";

export function DetailsRatings({
  rtData,
  isLoadingRt,
  mediaId,
  mediaType,
  imdbId,
}: DetailsRatingsProps) {
  return (
    <div className="space-y-1">
      <div className="flex gap-3 mt-2">
        {mediaId && (
          <a
            href={`https://www.themoviedb.org/${mediaType === "show" ? "tv" : "movie"}/${mediaId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-8 h-8 rounded-md bg-[#0d253f] flex items-center justify-center transition-transform hover:scale-110 animate-[scaleIn_0.6s_ease-out_forwards]"
            style={{
              animationDelay: "60ms",
              transform: "scale(0)",
              opacity: 0,
            }}
            title={t("details.tmdb")}
          >
            <Icon icon={Icons.TMDB} className="text-white" />
          </a>
        )}
        {imdbId && (
          <a
            href={`https://www.imdb.com/title/${imdbId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-8 h-8 rounded-md bg-yellow-500 flex items-center justify-center transition-transform hover:scale-110 animate-[scaleIn_0.6s_ease-out_forwards]"
            style={{
              animationDelay: "120ms",
              transform: "scale(0)",
              opacity: 0,
            }}
            title={t("details.imdb")}
          >
            <Icon icon={Icons.IMDB} className="text-black" />
          </a>
        )}
        {isLoadingRt ? (
          <>
            <div className="w-8 h-8 rounded-md bg-white/10 animate-pulse" />
            <div className="w-8 h-8 rounded-md bg-white/10 animate-pulse" />
          </>
        ) : (
          <>
            {rtData && (
              <a
                href={rtData.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center transition-transform hover:scale-110 animate-[scaleIn_0.6s_ease-out_forwards]"
                style={{
                  animationDelay: "180ms",
                  transform: "scale(0)",
                  opacity: 0,
                }}
                title="Rotten Tomatoes"
              >
                <img
                  src={getRTIcon(rtData.tomatoIcon)}
                  alt="Tomatometer"
                  className="w-8 h-8"
                />
              </a>
            )}
            {typeof rtData?.popcornScore === "number" && (
              <a
                href={rtData.popcornUrl ?? rtData.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center transition-transform hover:scale-110 animate-[scaleIn_0.6s_ease-out_forwards]"
                style={{
                  animationDelay: "240ms",
                  transform: "scale(0)",
                  opacity: 0,
                }}
                title="Popcornmeter"
              >
                <img
                  src={getRTAudienceIcon(rtData.popcornIcon ?? "empty")}
                  alt="Popcornmeter"
                  className="w-8 h-8"
                />
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
