import { useEffect } from "react";

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
  const router = useOverlayRouter("settings");
  const setHasOpenOverlay = usePlayerStore((s) => s.setHasOpenOverlay);
  const { setDirectCaption } = useCaptions();
  const translateTask = usePlayerStore((s) => s.caption.translateTask);

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
        className={props.className}
        iconSizeClass={props.iconSizeClass}
        onClick={() => {
          router.open();
          router.navigate("/captionsOverlay");
        }}
        icon={Icons.CAPTIONS}
      />
    </OverlayAnchor>
  );
}
