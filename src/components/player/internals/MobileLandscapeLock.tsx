import { useEffect } from "react";

import { useIsMobile } from "@/hooks/useIsMobile";
import { usePlayerStore } from "@/stores/player/store";

const PLAYER_ROOT_SELECTOR = '[data-player-root="true"]';
const LANDSCAPE_FALLBACK_STYLE_ID = "mobile-landscape-lock-style";
const LANDSCAPE_FALLBACK_CLASS = "mobile-landscape-lock-fallback";
const LANDSCAPE_BODY_CLASS = "mobile-landscape-lock-body";

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

function isPortraitViewport() {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(orientation: portrait)").matches;
  }
  return window.innerHeight >= window.innerWidth;
}

function ensureFallbackStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById(LANDSCAPE_FALLBACK_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = LANDSCAPE_FALLBACK_STYLE_ID;
  style.textContent = `
${PLAYER_ROOT_SELECTOR}.${LANDSCAPE_FALLBACK_CLASS} {
  --player-landscape-width: 100vh;
  --player-landscape-height: 100vw;
  --player-overlay-max-height: calc(var(--player-landscape-height) - 1.5rem);
  position: fixed !important;
  width: var(--player-landscape-width) !important;
  height: var(--player-landscape-height) !important;
  top: 50% !important;
  left: 50% !important;
  transform: translate(-50%, -50%) rotate(90deg) !important;
  transform-origin: center center !important;
  z-index: 9999 !important;
  max-width: none !important;
  max-height: none !important;
}

@supports (width: 100dvh) {
  ${PLAYER_ROOT_SELECTOR}.${LANDSCAPE_FALLBACK_CLASS} {
    --player-landscape-width: 100dvh;
    --player-landscape-height: 100dvw;
  }
}

${PLAYER_ROOT_SELECTOR}.${LANDSCAPE_FALLBACK_CLASS} .h-screen {
  height: var(--player-landscape-height) !important;
  min-height: var(--player-landscape-height) !important;
}

body.${LANDSCAPE_BODY_CLASS} {
  overflow: hidden !important;
}
`;
  document.head.appendChild(style);
}

function setCssLandscapeFallback(enabled: boolean) {
  if (typeof document === "undefined") return;
  const playerRoot = document.querySelector<HTMLElement>(PLAYER_ROOT_SELECTOR);

  document.body.classList.toggle(LANDSCAPE_BODY_CLASS, enabled);
  if (!playerRoot) return;
  playerRoot.classList.toggle(LANDSCAPE_FALLBACK_CLASS, enabled);
}

export function MobileLandscapeLock() {
  const display = usePlayerStore((s) => s.display);
  const isFullscreen = usePlayerStore((s) => s.interface.isFullscreen);
  const { isMobile } = useIsMobile();
  const isWebPlayer = display?.getType() === "web";
  const shouldLock = isMobile && isWebPlayer && !isFullscreen;

  useEffect(() => {
    if (!shouldLock) {
      setCssLandscapeFallback(false);
      unlockOrientation();
      return;
    }

    ensureFallbackStyle();

    const applyLandscape = async () => {
      if (document.hidden) return;
      await lockLandscape();
      setCssLandscapeFallback(isPortraitViewport());
    };

    const retryLock = () => {
      void applyLandscape();
    };

    void applyLandscape();

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
      setCssLandscapeFallback(false);
      unlockOrientation();
    };
  }, [shouldLock]);
  return null;
}
