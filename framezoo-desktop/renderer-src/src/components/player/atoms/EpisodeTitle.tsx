import { useTranslation } from "react-i18next";

import { usePlayerStore } from "@/stores/player/store";
import { formatEpisodeTitle } from "@/utils/season";

export function EpisodeTitle() {
  const { t } = useTranslation();
  const meta = usePlayerStore((s) => s.meta);

  if (meta?.type !== "show") return null;

  const episodeTitle = formatEpisodeTitle(
    meta?.episode?.title,
    meta?.episode?.number,
    t,
  );

  return (
    <div className="flex items-center justify-center gap-3 min-w-0 truncate">
      <span className="text-white font-medium shrink-0">
        {t("media.episodeDisplay", {
          season: meta?.season?.number,
          episode: meta?.episode?.number,
        })}
      </span>
      {episodeTitle ? (
        <span className="text-type-secondary font-medium truncate min-w-0">
          {episodeTitle}
        </span>
      ) : null}
    </div>
  );
}
