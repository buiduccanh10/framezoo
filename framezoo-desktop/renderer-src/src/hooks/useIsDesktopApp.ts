import { useEffect, useState } from "react";

// Desktop app is detected via a global set by the Electron preload script.
declare global {
  interface Window {
    __FRAMEZOO_DESKTOP__?: boolean;
  }
}

export function useIsDesktopApp(): boolean {
  return Boolean(window.__FRAMEZOO_DESKTOP__);
}

export function useIsMacDesktop(): boolean {
  const electronApi =
    typeof window !== "undefined" ? window.electronAPI : undefined;
  return Boolean(
    typeof window !== "undefined" &&
    window.__FRAMEZOO_DESKTOP__ &&
    (electronApi?.isMac ||
      electronApi?.platform === "darwin" ||
      /Macintosh|Mac OS X/i.test(navigator.userAgent)),
  );
}

export function useDesktopFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const electronApi = window.electronAPI;
    if (!electronApi) return;

    if (typeof electronApi.getFullscreenState === "function") {
      electronApi
        .getFullscreenState()
        .then((fs: boolean) => setIsFullscreen(Boolean(fs)))
        .catch(() => {});
    }

    if (typeof electronApi.onFullscreenState === "function") {
      const unsubscribe = electronApi.onFullscreenState((fs: boolean) => {
        setIsFullscreen(Boolean(fs));
      });
      return () => {
        unsubscribe?.();
      };
    }
  }, []);

  return isFullscreen;
}

export function useIsMacWindowed(): boolean {
  const isMac = useIsMacDesktop();
  const isFullscreen = useDesktopFullscreen();
  return isMac && !isFullscreen;
}
