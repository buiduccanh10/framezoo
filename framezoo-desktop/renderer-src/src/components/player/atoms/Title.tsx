import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { useCopyToClipboard } from "react-use";

import { TMDBIdToUrlId } from "@/backend/metadata/tmdb";
import { MWMediaType } from "@/backend/metadata/types/mw";
import { conf } from "@/setup/config";
import { useToastStore } from "@/stores/interface/toast";
import { usePlayerStore } from "@/stores/player/store";
import { formatSeconds } from "@/utils/formatSeconds";

export function Title() {
  const { t } = useTranslation();
  const meta = usePlayerStore((s) => s.meta);
  const title = meta?.title;
  const { time } = usePlayerStore((s) => s.progress);
  const params = useParams<{ media?: string }>();
  const [, copyToClipboard] = useCopyToClipboard();
  const showToast = useToastStore((s) => s.showToast);

  const handleTitleClick = (e: React.MouseEvent) => {
    let urlId = params.media;
    if (!urlId && meta?.tmdbId && meta?.title) {
      urlId = TMDBIdToUrlId(
        meta.type === "movie" ? MWMediaType.MOVIE : MWMediaType.SERIES,
        meta.tmdbId,
        meta.title,
      );
    }
    if (!urlId) return;

    const baseLink = `${conf().APP_DOMAIN}/discover?detail=${urlId}`;
    const timeStamp = formatSeconds(time, time >= 3600);

    const linkToCopy = e.shiftKey ? `${baseLink}&t=${timeStamp}` : baseLink;
    copyToClipboard(linkToCopy);
    showToast(t("toasts.linkCopied"), "success");
  };

  if (!title) {
    return (
      <div
        aria-hidden="true"
        className="h-4 w-32 animate-pulse rounded bg-white/15"
      />
    );
  }

  return (
    <p
      onClick={handleTitleClick}
      className="cursor-copy transform truncate transition-transform duration-200 hover:scale-105"
      title="Copy link"
    >
      {title}
    </p>
  );
}
