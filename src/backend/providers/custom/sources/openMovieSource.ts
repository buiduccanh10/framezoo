import {
  type MovieScrapeContext,
  NotFoundError,
  type ShowScrapeContext,
  type SourcererOutput,
  flags,
} from "@p-stream/providers";

const BASE_URL = (() => {
  const envUrl =
    import.meta.env.VITE_TMDB_EMBED_API_URL || "http://localhost:8787";
  if (envUrl.startsWith("/") && typeof window !== "undefined") {
    return window.location.origin + envUrl;
  }
  return envUrl;
})();

const OPENMOVIE_API_BASE = `${BASE_URL}/api/streams`;

// Define base URL object once for reuse
const BASE_URL_OBJ = new URL(BASE_URL);

// Quality mapping for consistent output
const QUALITY_MAP: Record<string, string> = {
  "2160p": "4k",
  "1440p": "1440",
  "1080p": "1080",
  "720p": "720",
  "480p": "480",
  "360p": "360",
};

// Helper to check if URL is HLS
function isHlsUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return (
    lowerUrl.includes("m3u8") ||
    lowerUrl.includes("/api/streams/") ||
    lowerUrl.includes("/m3u8-proxy") ||
    lowerUrl.endsWith(".m3u8") ||
    lowerUrl.includes(".m3u8?")
  );
}

interface OpenMovieStream {
  name: string;
  title: string;
  url: string;
  subtitle?: string;
  quality: string;
  provider: string;
}

interface OpenMovieApiResponse {
  success: boolean;
  tmdbId: string;
  imdbId: string | null;
  count: number;
  providerTimings: Record<string, number>;
  streams: OpenMovieStream[];
}

function fixStreamUrl(url: string, baseUrl: string): string {
  if (!url) return url;

  try {
    // Avoid creating new URL objects if possible for simple relative paths
    if (url.startsWith("/")) {
      return baseUrl + url;
    }

    if (!url.startsWith("http")) {
      if (url.includes("-proxy?")) {
        return baseUrl + (url.startsWith("/") ? "" : "/") + url;
      }
      return url;
    }

    const urlObj = new URL(url);

    // If protocol and host already match, just return as is
    if (urlObj.origin === BASE_URL_OBJ.origin && url.startsWith(baseUrl)) {
      return url;
    }

    const pathAndSearch = urlObj.pathname + urlObj.search;

    // If the URL is a proxy URL
    if (pathAndSearch.includes("-proxy?")) {
      const basePath =
        BASE_URL_OBJ.pathname === "/" ? "" : BASE_URL_OBJ.pathname;

      // If the pathname already starts with the prefix, just fix the origin/protocol
      if (basePath && urlObj.pathname.startsWith(basePath)) {
        return BASE_URL_OBJ.origin + pathAndSearch;
      }

      // Otherwise, prepend the whole baseUrl
      return baseUrl + pathAndSearch;
    }

    // Case 2: Literal localhost:8787 (development fallback)
    if (url.includes("localhost:8787")) {
      return url.replace(/https?:\/\/localhost:8787/, baseUrl);
    }
  } catch {
    // Fallback for malformed URLs
    if (url.includes("-proxy?") && !url.startsWith("http")) {
      return baseUrl + (url.startsWith("/") ? "" : "/") + url;
    }
  }

  return url;
}

function fixSubtitleUrl(
  url: string | undefined,
  baseUrl: string,
): string | undefined {
  if (!url) return url;

  // Apply general mapping first
  const fixed = fixStreamUrl(url, baseUrl);

  // If still external and doesn't use our proxy, wrap it in sub-proxy for CORS
  if (fixed && !fixed.startsWith(baseUrl) && fixed.startsWith("http")) {
    return `${baseUrl}/sub-proxy?url=${encodeURIComponent(fixed)}`;
  }

  return fixed;
}

export async function scrapeOpenMovieMovie(
  ctx: MovieScrapeContext,
): Promise<SourcererOutput> {
  ctx.progress(10);

  const apiUrl = `${OPENMOVIE_API_BASE}/movie/${ctx.media.tmdbId}`;

  try {
    const data = await ctx.fetcher<OpenMovieApiResponse>(apiUrl);

    if (!data.success || !data.streams?.length) {
      throw new NotFoundError("No streams found on OpenMovie");
    }

    // Map each stream to direct stream output to bypass embed phase and optimize speed
    const streams = data.streams.map((stream) => {
      const fixedUrl = fixStreamUrl(stream.url, BASE_URL);
      const fixedSubtitle = fixSubtitleUrl(stream.subtitle, BASE_URL);
      const isHls = isHlsUrl(fixedUrl);
      const quality =
        QUALITY_MAP[stream.quality] ||
        stream.quality?.replace("p", "") ||
        "unknown";

      const streamBase = {
        id: `openmovie-${stream.provider}-${isHls ? "hls" : "file"}-${quality}-${Math.random().toString(36).slice(2, 7)}`,
        flags: [flags.CORS_ALLOWED],
        captions: fixedSubtitle
          ? [
              {
                id: fixedSubtitle,
                type: "srt" as const,
                url: fixedSubtitle,
                hasCorsRestrictions: false,
                language: "en",
              },
            ]
          : [],
        skipValidation: true,
        qualities: {
          [quality]: {
            type: isHls ? ("hls" as const) : ("mp4" as const),
            url: fixedUrl,
          },
        },
      };

      if (isHls) {
        return {
          ...streamBase,
          type: "hls" as const,
          playlist: fixedUrl,
        };
      }

      return {
        ...streamBase,
        type: "file" as const,
      };
    });

    ctx.progress(100);
    return {
      stream: streams,
      embeds: [],
    };
  } catch (err) {
    console.error("[OpenMovie] Scrape failed:", err);
    if (err instanceof NotFoundError) throw err;
    throw new NotFoundError("Failed to fetch streams from OpenMovie");
  }
}

export async function scrapeOpenMovieShow(
  ctx: ShowScrapeContext,
): Promise<SourcererOutput> {
  ctx.progress(10);

  const apiUrl = `${OPENMOVIE_API_BASE}/series/${ctx.media.tmdbId}?season=${ctx.media.season.number}&episode=${ctx.media.episode.number}`;

  try {
    const data = await ctx.fetcher<OpenMovieApiResponse>(apiUrl);

    if (!data.success || !data.streams?.length) {
      throw new NotFoundError("No streams found on OpenMovie");
    }

    const streams = data.streams.map((stream) => {
      const fixedUrl = fixStreamUrl(stream.url, BASE_URL);
      const fixedSubtitle = fixSubtitleUrl(stream.subtitle, BASE_URL);
      const isHls = isHlsUrl(fixedUrl);
      const quality =
        QUALITY_MAP[stream.quality] ||
        stream.quality?.replace("p", "") ||
        "unknown";

      const streamBase = {
        id: `openmovie-${stream.provider}-${isHls ? "hls" : "file"}-${quality}-${Math.random().toString(36).slice(2, 7)}`,
        flags: [flags.CORS_ALLOWED],
        captions: fixedSubtitle
          ? [
              {
                id: fixedSubtitle,
                type: "srt" as const,
                url: fixedSubtitle,
                hasCorsRestrictions: false,
                language: "en",
              },
            ]
          : [],
        skipValidation: true,
        qualities: {
          [quality]: {
            type: isHls ? ("hls" as const) : ("mp4" as const),
            url: fixedUrl,
          },
        },
      };

      if (isHls) {
        return {
          ...streamBase,
          type: "hls" as const,
          playlist: fixedUrl,
        };
      }

      return {
        ...streamBase,
        type: "file" as const,
      };
    });

    ctx.progress(100);
    return {
      stream: streams,
      embeds: [],
    };
  } catch (err) {
    console.error("[OpenMovie] Show Scrape failed:", err);
    if (err instanceof NotFoundError) throw err;
    throw new NotFoundError("Failed to fetch streams from OpenMovie");
  }
}
