// Desktop app is detected via a global set by the Electron preload script.
declare global {
  interface Window {
    __ALPHAFLIX_DESKTOP__?: boolean;
    __BETAMOVIE_DESKTOP__?: boolean;
  }
}

export function useIsDesktopApp(): boolean {
  return Boolean(window.__ALPHAFLIX_DESKTOP__ || window.__BETAMOVIE_DESKTOP__);
}
