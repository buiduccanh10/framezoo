import { conf } from "@/setup/config";
import { useAuthStore } from "@/stores/auth";

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
  const urls = [config.BACKEND_URL, ...config.BACKEND_URLS].filter(
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
  if (trimmed.startsWith("/api/")) return true;

  const backendOrigins = getBackendOrigins();
  if (backendOrigins.length === 0) return false;

  try {
    const parsedUrl = new URL(trimmed);
    return (
      backendOrigins.includes(parsedUrl.origin) &&
      parsedUrl.pathname.startsWith("/api/")
    );
  } catch {
    return false;
  }
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

  const token = useAuthStore.getState().account?.token;
  if (token) {
    nextHeaders.set("authorization", `Bearer ${token}`);
  }

  return nextHeaders;
}
