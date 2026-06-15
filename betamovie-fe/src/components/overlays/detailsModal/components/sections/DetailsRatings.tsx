import { t } from "i18next";

import { Icon, Icons } from "@/components/Icon";
import { getRTIcon } from "@/utils/rottenTomatoesScraper";

import { DetailsRatingsProps } from "../../types";

export function DetailsRatings({
  rtData,
  mediaId,
  mediaType,
  imdbId,
}: DetailsRatingsProps) {
  return (
    <div className="space-y-1">
      {/* External Links */}
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
        {rtData && (
          <div className="flex items-center gap-1">
            <div className="flex flex-col items-center justify-center gap-1">
              <div
                className="flex items-center gap-1 animate-[scaleIn_0.6s_ease-out_forwards]"
                style={{
                  animationDelay: "180ms",
                  transform: "scale(0)",
                  opacity: 0,
                }}
                title="Tomatometer"
              >
                <img
                  src={getRTIcon(rtData.tomatoIcon)}
                  alt="Tomatometer"
                  className="w-8 h-8"
                />
                <span className="text-sm pl-1 text-white/80">
                  {rtData.tomatoScore}%
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
