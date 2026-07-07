export type ExtensionMessageName =
  | "hello"
  | "makeRequest"
  | "prepareStream"
  | "openPage";

export type StreamRule = {
  targetDomains: string[];
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
};

export type DesktopAppUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopAppUpdateState = {
  status: DesktopAppUpdateStatus;
  updateToken: string | null;
  updateVersion: string | null;
  progressPercent: number | null;
  errorMessage: string | null;
};

export type CreateDesktopAppUpdaterOptions = {
  appName: string;
  checkIntervalMs: number;
  getBackendUrl: () => string;
  onStateChange?: (state: DesktopAppUpdateState) => void;
  updateChannel: string;
};

export type DesktopPipState = Record<string, unknown> | null;

export type CreateDesktopPipControllerOptions = {
  desktopPipRoute: string;
  enableDevTools: boolean;
  onClosed?: () => void;
  preloadPath: string;
  rendererDevUrl?: string;
  rendererEntryPath: string;
};
