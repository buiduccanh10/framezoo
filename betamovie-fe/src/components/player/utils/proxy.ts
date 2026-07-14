import { getLoadbalancedM3U8ProxyUrl } from "@/backend/providers/fetchers";
import { conf } from "@/setup/config";
import { getM3U8ProxyUrls } from "@/utils/proxyUrls";

/**
 * Creates a proxied M3U8 URL for HLS streams using a random proxy from config
 * @param url - The original M3U8 URL to proxy
 * @param headers - Headers to include with the request
 * @returns The proxied M3U8 URL
 */
export async function createM3U8ProxyUrl(
  url: string,
  headers: Record<string, string> = {},
): Promise<string> {
  const backendUrl = conf().BACKEND_URL?.replace(/\/+$/, "");
  if (backendUrl) {
    try {
      const response = await fetch(`${backendUrl}/api/proxy/capability`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "m3u8",
          url,
          headers,
        }),
      });
      if (response.ok) {
        const payload = (await response.json()) as { url?: string };
        if (payload.url) return payload.url;
      }
    } catch {
      // Fall through to configured external proxy compatibility.
    }
  }

  // Get a random M3U8 proxy URL from the configuration
  const proxyBaseUrl = getLoadbalancedM3U8ProxyUrl();

  if (!proxyBaseUrl) {
    console.warn("No M3U8 proxy URLs available in configuration");
    return url; // Fallback to original URL
  }

  const encodedUrl = encodeURIComponent(url);
  const encodedHeaders = encodeURIComponent(JSON.stringify(headers));
  return `${proxyBaseUrl}/m3u8-proxy?url=${encodedUrl}${headers ? `&headers=${encodedHeaders}` : ""}`;
}

/**
 * TODO: Creates a proxied MP4 URL for MP4 streams
 * @param url - The original MP4 URL to proxy
 * @param headers - Headers to include with the request
 * @returns The proxied MP4 URL
 */
export function createMP4ProxyUrl(
  url: string,
  _headers: Record<string, string> = {},
): string {
  // TODO: Implement MP4 proxy for protected streams
  // This would need a separate MP4 proxy service that can handle headers
  // For now, return the original URL
  console.warn("MP4 proxy not yet implemented - using original URL");
  return url;
}

/**
 * Checks if a URL is already using one of the configured M3U8 proxy services
 * @param url - The URL to check
 * @returns True if the URL is already proxied, false otherwise
 */
export function isUrlAlreadyProxied(url: string): boolean {
  // Check if URL contains the m3u8-proxy pattern (Airplay format)
  if (url.includes("/m3u8-proxy?")) {
    return true;
  }

  // Check if URL contains the destination pattern (Chromecast format)
  if (url.includes("/?destination=")) {
    return true;
  }

  // Also check if URL starts with any of the configured proxy URLs
  const proxyUrls = getM3U8ProxyUrls();
  return proxyUrls.some((proxyUrl) => url.startsWith(proxyUrl));
}
