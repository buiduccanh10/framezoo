import { conf } from "@/setup/config";
import { useAuthStore } from "@/stores/auth";

const GUEST_TOKEN_KEY = "fz_guest_token";
const GUEST_TOKEN_EXP_KEY = "fz_guest_token_exp";

let inMemoryGuestToken: string | null = null;
let inMemoryGuestTokenExp = 0;
let pendingGuestTokenPromise: Promise<string | null> | null = null;

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveRequestUrl(url: string, baseURL?: string): string {
  if (!baseURL) return url;

  const trimmedUrl = url.trim();
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmedUrl)) {
    return trimmedUrl;
  }

  try {
    const base = new URL(normalizeUrl(baseURL));
    const basePath = base.pathname.endsWith("/")
      ? base.pathname
      : `${base.pathname}/`;
    const path = trimmedUrl.startsWith("/") ? trimmedUrl.slice(1) : trimmedUrl;
    return `${base.origin}${basePath}${path}`;
  } catch {
    const normalizedBaseUrl = normalizeUrl(baseURL);
    if (trimmedUrl.startsWith("/")) {
      return `${normalizedBaseUrl}${trimmedUrl}`;
    }
    return `${normalizedBaseUrl}/${trimmedUrl}`;
  }
}

function getBackendOrigins(): string[] {
  const config = conf();
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  const urls = [config.BACKEND_URL, ...config.BACKEND_URLS, origin].filter(
    (value): value is string => Boolean(value),
  );

  return Array.from(
    new Set(
      urls
        .map((value) => {
          try {
            return new URL(normalizeUrl(value)).origin;
          } catch {
            return "";
          }
        })
        .filter(Boolean),
    ),
  );
}

export function isBackendApiRequest(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.startsWith("/api/") || trimmed.startsWith("/addon/subtitles/")) {
    return true;
  }

  const backendOrigins = getBackendOrigins();
  if (backendOrigins.length === 0) return false;

  try {
    const parsedUrl = new URL(trimmed);
    return (
      backendOrigins.includes(parsedUrl.origin) &&
      (parsedUrl.pathname.startsWith("/api/") ||
        parsedUrl.pathname.startsWith("/addon/subtitles/"))
    );
  } catch {
    return false;
  }
}

export function getStoredGuestToken(): string | null {
  const now = Date.now();
  if (inMemoryGuestToken && inMemoryGuestTokenExp - now > 30_000) {
    return inMemoryGuestToken;
  }

  try {
    const storedToken = localStorage.getItem(GUEST_TOKEN_KEY);
    const storedExp = Number(localStorage.getItem(GUEST_TOKEN_EXP_KEY) || "0");
    if (storedToken && storedExp - now > 30_000) {
      inMemoryGuestToken = storedToken;
      inMemoryGuestTokenExp = storedExp;
      return storedToken;
    }
  } catch {
    // Ignore localStorage access issues
  }

  return null;
}

export async function ensureGuestToken(
  forceRefresh = false,
): Promise<string | null> {
  if (!forceRefresh) {
    const existing = getStoredGuestToken();
    if (existing) return existing;
  }

  if (pendingGuestTokenPromise) {
    return pendingGuestTokenPromise;
  }

  pendingGuestTokenPromise = (async () => {
    try {
      const config = conf();
      const rawBackendUrl =
        config.BACKEND_URL ||
        (config.BACKEND_URLS.length > 0 ? config.BACKEND_URLS[0] : "") ||
        (typeof window !== "undefined" ? window.location.origin : "");
      const backendUrl = normalizeUrl(rawBackendUrl);
      if (!backendUrl) return null;

      const response = await fetch(`${backendUrl}/api/auth/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
      };

      if (!data.access_token) return null;

      const token = data.access_token;
      const expiresInMs = (data.expires_in ?? 1800) * 1000;
      const expTimestamp = Date.now() + expiresInMs;

      inMemoryGuestToken = token;
      inMemoryGuestTokenExp = expTimestamp;

      try {
        localStorage.setItem(GUEST_TOKEN_KEY, token);
        localStorage.setItem(GUEST_TOKEN_EXP_KEY, String(expTimestamp));
      } catch {
        // Ignore localStorage error
      }

      return token;
    } catch {
      return null;
    } finally {
      pendingGuestTokenPromise = null;
    }
  })();

  return pendingGuestTokenPromise;
}

export function getBackendAuthHeaders(
  url: string,
  headers?: HeadersInit,
  baseURL?: string,
): Headers {
  const nextHeaders = new Headers(headers ?? {});
  const resolvedUrl = resolveRequestUrl(url, baseURL);

  if (!isBackendApiRequest(resolvedUrl)) {
    return nextHeaders;
  }

  const userToken = useAuthStore.getState().account?.token;
  if (userToken) {
    nextHeaders.set("authorization", `Bearer ${userToken}`);
    return nextHeaders;
  }

  const guestToken = getStoredGuestToken();
  if (guestToken) {
    nextHeaders.set("authorization", `Bearer ${guestToken}`);
  }

  return nextHeaders;
}

export async function getBackendAuthHeadersAsync(
  url: string,
  headers?: HeadersInit,
  baseURL?: string,
): Promise<Headers> {
  const nextHeaders = new Headers(headers ?? {});
  const resolvedUrl = resolveRequestUrl(url, baseURL);

  if (!isBackendApiRequest(resolvedUrl)) {
    return nextHeaders;
  }

  const userToken = useAuthStore.getState().account?.token;
  if (userToken) {
    nextHeaders.set("authorization", `Bearer ${userToken}`);
    return nextHeaders;
  }

  const guestToken = (await ensureGuestToken()) || getStoredGuestToken();
  if (guestToken) {
    nextHeaders.set("authorization", `Bearer ${guestToken}`);
  }

  return nextHeaders;
}
