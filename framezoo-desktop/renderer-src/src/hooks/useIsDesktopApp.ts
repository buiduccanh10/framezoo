// Desktop app is detected via a global set by the Electron preload script.
declare global {
  interface Window {
    __FRAMEZOO_DESKTOP__?: boolean;
  }
}

export function useIsDesktopApp(): boolean {
  return Boolean(window.__FRAMEZOO_DESKTOP__);
}
