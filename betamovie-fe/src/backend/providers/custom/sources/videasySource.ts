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

const VIDEASY_API_BASE = `${getBaseUrl()}/api/streams/videasy`;

interface VideasyStream {
  name: string;
  title: string;
  url: string;
  subtitle?: string;
  quality: string;
  provider: string;
  preview?: StreamPreview;
}

interface VideasyApiResponse {
  success: boolean;
  tmdbId: string;
  imdbId: string | null;
  count: number;
  providerTimings: Record<string, number>;
  streams: VideasyStream[];
}

function buildContextQuery(
  ctx: MovieScrapeContext | ShowScrapeContext,
): string {
  const query = new URLSearchParams();

  if (
    typeof ctx.media?.title === "string" &&
    ctx.media.title.trim().length > 0
  ) {
    query.set("title", ctx.media.title.trim());
  }

  if (
    typeof ctx.media?.releaseYear === "number" &&
    Number.isFinite(ctx.media.releaseYear)
  ) {
    query.set("releaseYear", String(ctx.media.releaseYear));
  }

  const queryString = query.toString();
  return queryString ? `?${queryString}` : "";
}

function encodeStreamInfo(stream: VideasyStream): string {
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

function mapStreamsToEmbeds(streams: VideasyStream[]) {
  return streams.map((stream) => {
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
}

export async function scrapeVideasyMovie(
  ctx: MovieScrapeContext,
): Promise<SourcererOutput> {
  ctx.progress(10);

  const apiUrl = `${VIDEASY_API_BASE}/movie/${ctx.media.tmdbId}${buildContextQuery(ctx)}`;

  try {
    const data = await ctx.fetcher<VideasyApiResponse>(apiUrl, {
      credentials: "include",
    });

    if (!data.success || !data.streams?.length) {
      throw new NotFoundError("No streams found on Videasy");
    }

    ctx.progress(100);
    return {
      embeds: mapStreamsToEmbeds(data.streams),
    };
  } catch (err) {
    console.error("[Videasy] Scrape failed:", err);
    if (err instanceof NotFoundError) throw err;
    throw new NotFoundError("Failed to fetch streams from Videasy");
  }
}

export async function scrapeVideasyShow(
  ctx: ShowScrapeContext,
): Promise<SourcererOutput> {
  ctx.progress(10);

  const apiUrl = `${VIDEASY_API_BASE}/tv/${ctx.media.tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}${buildContextQuery(ctx)}`;

  try {
    const data = await ctx.fetcher<VideasyApiResponse>(apiUrl, {
      credentials: "include",
    });

    if (!data.success || !data.streams?.length) {
      throw new NotFoundError("No streams found on Videasy");
    }

    ctx.progress(100);
    return {
      embeds: mapStreamsToEmbeds(data.streams),
    };
  } catch (err) {
    console.error("[Videasy] Show scrape failed:", err);
    if (err instanceof NotFoundError) throw err;
    throw new NotFoundError("Failed to fetch streams from Videasy");
  }
}
