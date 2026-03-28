import { useEffect, useState } from "react";

import { useIsMobile } from "@/hooks/useIsMobile";
import { playerStatus } from "@/stores/player/slices/source";
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
  const status = usePlayerStore((s) => s.status);
  const { isMobile } = useIsMobile();
  const shouldLock = isMobile && status === playerStatus.PLAYING;
  const [isPortrait, setIsPortrait] = useState(() =>
    typeof window !== "undefined"
      ? window.innerHeight > window.innerWidth
      : false,
  );

  useEffect(() => {
    const updateOrientation = () => {
      setIsPortrait(window.innerHeight > window.innerWidth);
    };

    updateOrientation();
    window.addEventListener("resize", updateOrientation);
    window.addEventListener("orientationchange", updateOrientation);

    return () => {
      window.removeEventListener("resize", updateOrientation);
      window.removeEventListener("orientationchange", updateOrientation);
    };
  }, []);

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

    return () => {
      document.removeEventListener("fullscreenchange", retryLock);
      document.removeEventListener("visibilitychange", retryLock);
      window.removeEventListener("focus", retryLock);
      unlockOrientation();
    };
  }, [shouldLock]);

  if (!shouldLock || !isPortrait) return null;

  return (
    <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/95 px-6 text-center text-white">
      <div className="max-w-xs space-y-3">
        <p className="text-lg font-semibold">Rotate your device</p>
        <p className="text-sm text-type-secondary">
          Landscape mode is required while the video is playing.
        </p>
      </div>
    </div>
  );
}
