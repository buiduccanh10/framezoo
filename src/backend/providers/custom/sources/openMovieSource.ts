import {
  type MovieScrapeContext,
  NotFoundError,
  type ShowScrapeContext,
  type SourcererOutput,
  type StreamPreview,
} from "@/lib/providers";

const getBaseUrl = () => {
  const backendUrl =
    import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";
  return `${backendUrl}/api/embed`;
};

const OPENMOVIE_API_BASE = `${getBaseUrl()}/api/streams/vixsrc`;

interface OpenMovieStream {
  name: string;
  title: string;
  url: string;
  subtitle?: string;
  quality: string;
  provider: string;
  preview?: StreamPreview;
}

interface OpenMovieApiResponse {
  success: boolean;
  tmdbId: string;
  imdbId: string | null;
  count: number;
  providerTimings: Record<string, number>;
  streams: OpenMovieStream[];
}

// Encode stream info into URL for the embed scraper to parse
function encodeStreamInfo(stream: OpenMovieStream): string {
  const info = {
    name: stream.name,
    title: stream.title,
    url: stream.url,
    subtitle: stream.subtitle,
    quality: stream.quality,
    provider: stream.provider,
    preview: stream.preview,
  };
  return `openmovie://${encodeURIComponent(JSON.stringify(info))}`;
}

function fixStreamUrl(url: string, baseUrl: string): string {
  if (!url) return url;

  try {
    const urlObj = new URL(url);
    const baseObj = new URL(baseUrl);

    // If protocol and host already match, just return as is
    if (urlObj.origin === baseObj.origin && url.startsWith(baseUrl)) {
      return url;
    }

    const pathAndSearch = urlObj.pathname + urlObj.search;

    // If the URL is a proxy URL
    if (pathAndSearch.includes("-proxy?")) {
      const basePath = baseObj.pathname === "/" ? "" : baseObj.pathname;

      // If the pathname already starts with the prefix, just fix the origin/protocol
      if (basePath && urlObj.pathname.startsWith(basePath)) {
        return baseObj.origin + pathAndSearch;
      }

      // Otherwise, prepend the whole baseUrl
      return baseUrl + pathAndSearch;
    }
  } catch {
    // Fallback for relative or malformed URLs
    if (url.includes("-proxy?") && !url.startsWith("http")) {
      return baseUrl + (url.startsWith("/") ? "" : "/") + url;
    }
  }

  // Case 2: Literal localhost:8787 (development fallback)
  if (url.includes("localhost:8787")) {
    return url.replace(/https?:\/\/localhost:8787/, baseUrl);
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
    const data = await ctx.fetcher<OpenMovieApiResponse>(apiUrl, {
      credentials: "include",
    });

    if (!data.success || !data.streams?.length) {
      throw new NotFoundError("No streams found on OpenMovie");
    }

    // Map each stream to an embed entry
    const embeds = data.streams.map((stream) => {
      const baseUrl = getBaseUrl();
      const fixedUrl = fixStreamUrl(stream.url, baseUrl);
      const fixedSubtitle = fixSubtitleUrl(stream.subtitle, baseUrl);

      return {
        embedId: "openmovie-embed",
        url: encodeStreamInfo({
          ...stream,
          url: fixedUrl,
          subtitle: fixedSubtitle,
        }),
      };
    });

    ctx.progress(100);
    return {
      embeds,
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

  const apiUrl = `${OPENMOVIE_API_BASE}/tv/${ctx.media.tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}`;

  try {
    const data = await ctx.fetcher<OpenMovieApiResponse>(apiUrl, {
      credentials: "include",
    });

    if (!data.success || !data.streams?.length) {
      throw new NotFoundError("No streams found on OpenMovie");
    }

    const embeds = data.streams.map((stream) => {
      const baseUrl = getBaseUrl();
      const fixedUrl = fixStreamUrl(stream.url, baseUrl);
      const fixedSubtitle = fixSubtitleUrl(stream.subtitle, baseUrl);

      return {
        embedId: "openmovie-embed",
        url: encodeStreamInfo({
          ...stream,
          url: fixedUrl,
          subtitle: fixedSubtitle,
        }),
      };
    });

    ctx.progress(100);
    return {
      embeds,
    };
  } catch (err) {
    console.error("[OpenMovie] Show Scrape failed:", err);
    if (err instanceof NotFoundError) throw err;
    throw new NotFoundError("Failed to fetch streams from OpenMovie");
  }
}
