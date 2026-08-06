import classNames from "classnames";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { Icons } from "@/components/Icon";
import { OverlayAnchor } from "@/components/overlays/OverlayAnchor";
import { useCaptions } from "@/components/player/hooks/useCaptions";
import { VideoPlayerButton } from "@/components/player/internals/Button";
import { useOverlayRouter } from "@/hooks/useOverlayRouter";
import { usePlayerStore } from "@/stores/player/store";

export function Captions(props: {
  iconSizeClass?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const router = useOverlayRouter("settings");
  const setHasOpenOverlay = usePlayerStore((s) => s.setHasOpenOverlay);
  const { setDirectCaption } = useCaptions();
  const translateTask = usePlayerStore((s) => s.caption.translateTask);
  const isLoadingExternalSubtitles = usePlayerStore(
    (s) => s.isLoadingExternalSubtitles,
  );
  const externalSubtitleLoadProgress = usePlayerStore(
    (s) => s.externalSubtitleLoadProgress,
  );
  const externalSubtitleProgress = Math.min(
    100,
    externalSubtitleLoadProgress.total > 0
      ? Math.round(
          (externalSubtitleLoadProgress.completed /
            externalSubtitleLoadProgress.total) *
            100,
        )
      : 0,
  );
  const externalSubtitleProgressLabel = t(
    "player.menus.subtitles.loadingExternalProgress",
    {
      progress: externalSubtitleProgress,
      defaultValue: "Loading external subtitles... ({{progress}}%)",
    },
  );

  useEffect(() => {
    setHasOpenOverlay(router.isRouterActive);
  }, [setHasOpenOverlay, router.isRouterActive]);

  useEffect(() => {
    if (!translateTask) {
      return;
    }
    if (translateTask.done) {
      const tCaption = translateTask.translatedCaption!;
      setDirectCaption(tCaption, {
        id: tCaption.id,
        url: "",
        language: tCaption.language,
        needsProxy: false,
      });
    }
  }, [translateTask, setDirectCaption]);

  return (
    <OverlayAnchor id={router.id}>
      <VideoPlayerButton
        className={classNames("relative", props.className)}
        iconSizeClass={classNames(
          props.iconSizeClass || "text-[32px]",
          "transition-opacity duration-200",
          isLoadingExternalSubtitles && "opacity-40",
        )}
        onClick={() => {
          router.open();
          router.navigate("/captionsOverlay");
        }}
        icon={Icons.CAPTIONS}
      >
        {isLoadingExternalSubtitles && (
          <span
            aria-label={externalSubtitleProgressLabel}
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-[0.55em] font-bold leading-none text-white"
          >
            {externalSubtitleProgress}%
          </span>
        )}
      </VideoPlayerButton>
    </OverlayAnchor>
  );
}
