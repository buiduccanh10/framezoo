import { APP_VERSION, BACKEND_URL } from "./constants";

interface Config {
  APP_VERSION: string;
  CORS_PROXY_URL: string;
  M3U8_PROXY_URL: string;
  NORMAL_ROUTER: boolean;
  BACKEND_URL: string;
  DISALLOWED_IDS: string;
  CDN_REPLACEMENTS: string;
  ALLOW_AUTOPLAY: boolean;
  SHOW_AD: boolean;
  AD_CONTENT_URL: string;
  TRACK_SCRIPT: string; // like <script src="https://umami.com/script.js"></script>
  BANNER_MESSAGE: string;
  BANNER_ID: string;

  SHOW_SUPPORT_BAR: boolean;
  SUPPORT_BAR_VALUE: string;
  TIDB_API_KEY: string;
  WYZIE_API_KEY: string;
  SUBSOURCE_API_KEY: string;
}

export interface RuntimeConfig {
  APP_VERSION: string;

  NORMAL_ROUTER: boolean;
  PROXY_URLS: string[];
  M3U8_PROXY_URLS: string[];
  BACKEND_URL: string | null;
  BACKEND_URLS: string[];
  DISALLOWED_IDS: string[];
  CDN_REPLACEMENTS: Array<string[]>;
  ALLOW_AUTOPLAY: boolean;
  SHOW_AD: boolean;
  AD_CONTENT_URL: string[];
  TRACK_SCRIPT: string | null;
  BANNER_MESSAGE: string | null;
  BANNER_ID: string | null;

  SHOW_SUPPORT_BAR: boolean;
  SUPPORT_BAR_VALUE: string;
  TIDB_API_KEY: string | null;
  WYZIE_API_KEY: string | null;
  SUBSOURCE_API_KEY: string | null;
}

const env: Record<keyof Config, undefined | string> = {
  APP_VERSION: undefined,

  CORS_PROXY_URL: import.meta.env.VITE_CORS_PROXY_URL,
  M3U8_PROXY_URL: import.meta.env.VITE_M3U8_PROXY_URL,
  NORMAL_ROUTER: import.meta.env.VITE_NORMAL_ROUTER,
  BACKEND_URL: import.meta.env.VITE_BACKEND_URL,
  DISALLOWED_IDS: import.meta.env.VITE_DISALLOWED_IDS,
  CDN_REPLACEMENTS: import.meta.env.VITE_CDN_REPLACEMENTS,
  ALLOW_AUTOPLAY: import.meta.env.VITE_ALLOW_AUTOPLAY,
  SHOW_AD: import.meta.env.VITE_SHOW_AD,
  AD_CONTENT_URL: import.meta.env.VITE_AD_CONTENT_URL,
  TRACK_SCRIPT: import.meta.env.VITE_TRACK_SCRIPT,
  BANNER_MESSAGE: import.meta.env.VITE_BANNER_MESSAGE,
  BANNER_ID: import.meta.env.VITE_BANNER_ID,

  SHOW_SUPPORT_BAR: import.meta.env.VITE_SHOW_SUPPORT_BAR,
  SUPPORT_BAR_VALUE: import.meta.env.VITE_SUPPORT_BAR_VALUE,
  TIDB_API_KEY: import.meta.env.VITE_TIDB_API_KEY,
  WYZIE_API_KEY: import.meta.env.VITE_WYZIE_API_KEY,
  SUBSOURCE_API_KEY: import.meta.env.VITE_SUBSOURCE_API_KEY,
};

function coerceUndefined(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  if (value.length === 0) return undefined;
  return value;
}

function isDesktopAppRuntime() {
  return (
    typeof window !== "undefined" &&
    Boolean((window as any).__ALPHAFLIX_DESKTOP__)
  );
}

// Desktop preload overrides build-time env so Electron keeps its injected backend URL.
function getKeyValue(key: keyof Config): string | undefined {
  const windowValue =
    typeof window !== "undefined"
      ? (window as any)?.__CONFIG__?.[`VITE_${key}`]
      : undefined;
  const envValue = coerceUndefined(env[key]);
  const runtimeValue = coerceUndefined(windowValue);

  if (isDesktopAppRuntime() && runtimeValue) {
    return runtimeValue;
  }

  return envValue ?? runtimeValue ?? undefined;
}

function getKey(key: keyof Config): string | null;
function getKey(key: keyof Config, defaultString: string): string;
function getKey(key: keyof Config, defaultString?: string): string | null {
  return getKeyValue(key)?.toString() ?? defaultString ?? null;
}

export function conf(): RuntimeConfig {
  return {
    APP_VERSION,
    BACKEND_URLS: getKey("BACKEND_URL", BACKEND_URL)
      ? getKey("BACKEND_URL", BACKEND_URL)
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : [],
    BACKEND_URL: (() => {
      const backendUrlValue = getKey("BACKEND_URL", BACKEND_URL);
      if (!backendUrlValue) return backendUrlValue;
      if (backendUrlValue.includes(",")) {
        const urls = backendUrlValue
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v.length > 0);
        return urls.length > 0 ? urls[0] : backendUrlValue;
      }
      return backendUrlValue;
    })(),
    PROXY_URLS: getKey("CORS_PROXY_URL", "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0),
    M3U8_PROXY_URLS: getKey("M3U8_PROXY_URL", "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0),
    NORMAL_ROUTER: getKey("NORMAL_ROUTER", "false") === "true",
    ALLOW_AUTOPLAY: getKey("ALLOW_AUTOPLAY", "false") === "true",
    DISALLOWED_IDS: getKey("DISALLOWED_IDS", "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0), // Should be comma-seperated and contain the media type and ID, formatted like so: movie-753342,movie-753342,movie-753342
    CDN_REPLACEMENTS: getKey("CDN_REPLACEMENTS", "")
      .split(",")
      .map((v) =>
        v
          .split(":")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      )
      .filter((v) => v.length === 2), // The format is <beforeA>:<afterA>,<beforeB>:<afterB>
    SHOW_AD: getKey("SHOW_AD", "false") === "true",
    AD_CONTENT_URL: getKey("AD_CONTENT_URL", "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0),
    TRACK_SCRIPT: getKey("TRACK_SCRIPT"),
    BANNER_MESSAGE: getKey("BANNER_MESSAGE"),
    BANNER_ID: getKey("BANNER_ID"),

    SHOW_SUPPORT_BAR: getKey("SHOW_SUPPORT_BAR", "false") === "true",
    SUPPORT_BAR_VALUE: getKey("SUPPORT_BAR_VALUE") ?? "",
    TIDB_API_KEY: getKey("TIDB_API_KEY"),
    WYZIE_API_KEY: getKey("WYZIE_API_KEY"),
    SUBSOURCE_API_KEY: getKey("SUBSOURCE_API_KEY"),
  };
}
