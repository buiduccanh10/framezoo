import { useEffect } from "react";

import { useIsMobile } from "@/hooks/useIsMobile";
import { usePlayerStore } from "@/stores/player/store";

type OrientationApi = ScreenOrientation & {
  lock?: (
    orientation: "any" | "natural" | "landscape" | "portrait",
  ) => Promise<void>;
  unlock?: () => void;
};

function getOrientationApi(): OrientationApi | null {
  if (typeof window === "undefined") return null;
  return (window.screen.orientation as OrientationApi | undefined) ?? null;
}

function unlockOrientation() {
  try {
    getOrientationApi()?.unlock?.();
  } catch {
    // Some mobile browsers expose the API but reject unlock calls.
  }
}

async function lockLandscape() {
  try {
    await getOrientationApi()?.lock?.("landscape");
  } catch {
    // Orientation lock is best-effort on the mobile web and may require fullscreen/PWA mode.
  }
}

export function MobileLandscapeLock() {
  const display = usePlayerStore((s) => s.display);
  const isFullscreen = usePlayerStore((s) => s.interface.isFullscreen);
  const { isMobile } = useIsMobile();
  const isWebPlayer = display?.getType() === "web";
  const shouldLock = isMobile && isWebPlayer && !isFullscreen;

  useEffect(() => {
    if (!shouldLock) {
      unlockOrientation();
      return;
    }

    const retryLock = () => {
      if (!document.hidden) {
        void lockLandscape();
      }
    };

    void lockLandscape();

    document.addEventListener("fullscreenchange", retryLock);
    document.addEventListener("visibilitychange", retryLock);
    window.addEventListener("focus", retryLock);
    window.addEventListener("orientationchange", retryLock);
    window.addEventListener("resize", retryLock);

    return () => {
      document.removeEventListener("fullscreenchange", retryLock);
      document.removeEventListener("visibilitychange", retryLock);
      window.removeEventListener("focus", retryLock);
      window.removeEventListener("orientationchange", retryLock);
      window.removeEventListener("resize", retryLock);
      unlockOrientation();
    };
  }, [shouldLock]);
  return null;
}
