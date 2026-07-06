import {
  type MovieScrapeContext,
  NotFoundError,
  type ShowScrapeContext,
  type SourcererOutput,
  type StreamPreview,
} from "@/lib/providers";
import { conf } from "@/setup/config";

const getBaseUrl = () => {
  const backendUrl =
    conf().BACKEND_URL?.replace(/\/+$/, "") || "http://localhost:3000";
  return `${backendUrl}/api/embed`;
};

const KKPHIM_API_BASE = `${getBaseUrl()}/api/streams/kkphim`;

interface KKPhimStream {
  name: string;
  title: string;
  url: string;
  subtitle?: string;
  quality: string;
  provider: string;
  preview?: StreamPreview;
}

interface KKPhimApiResponse {
  success: boolean;
  tmdbId: string;
  imdbId: string | null;
  count: number;
  providerTimings: Record<string, number>;
  streams: KKPhimStream[];
}

function encodeStreamInfo(stream: KKPhimStream): string {
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

    if (urlObj.origin === baseObj.origin && url.startsWith(baseUrl)) {
      return url;
    }

    const pathAndSearch = urlObj.pathname + urlObj.search;

    if (pathAndSearch.includes("-proxy?")) {
      const basePath = baseObj.pathname === "/" ? "" : baseObj.pathname;

      if (basePath && urlObj.pathname.startsWith(basePath)) {
        return baseObj.origin + pathAndSearch;
      }

      return baseUrl + pathAndSearch;
    }
  } catch {
    if (url.includes("-proxy?") && !url.startsWith("http")) {
      return baseUrl + (url.startsWith("/") ? "" : "/") + url;
    }
  }

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

  const fixed = fixStreamUrl(url, baseUrl);

  if (fixed && !fixed.startsWith(baseUrl) && fixed.startsWith("http")) {
    return `${baseUrl}/sub-proxy?url=${encodeURIComponent(fixed)}`;
  }

  return fixed;
}

export async function scrapeKKPhimMovie(
  ctx: MovieScrapeContext,
): Promise<SourcererOutput> {
  ctx.progress(10);
  const apiUrl = `${KKPHIM_API_BASE}/movie/${ctx.media.tmdbId}`;

  try {
    const data = await ctx.fetcher<KKPhimApiResponse>(apiUrl, {
      credentials: "include",
    });

    if (!data.success || !data.streams?.length) {
      throw new NotFoundError("No streams found on KKPhim");
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
    console.error("[KKPhim] Scrape failed:", err);
    if (err instanceof NotFoundError) throw err;
    throw new NotFoundError("Failed to fetch streams from KKPhim");
  }
}

export async function scrapeKKPhimShow(
  ctx: ShowScrapeContext,
): Promise<SourcererOutput> {
  ctx.progress(10);
  const apiUrl = `${KKPHIM_API_BASE}/tv/${ctx.media.tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}`;

  try {
    const data = await ctx.fetcher<KKPhimApiResponse>(apiUrl, {
      credentials: "include",
    });

    if (!data.success || !data.streams?.length) {
      throw new NotFoundError("No streams found on KKPhim");
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
    console.error("[KKPhim] Show scrape failed:", err);
    if (err instanceof NotFoundError) throw err;
    throw new NotFoundError("Failed to fetch streams from KKPhim");
  }
}
