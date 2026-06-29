import { get as fetchTmdb } from "@/backend/metadata/tmdb";
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

async function fetchTmdbLocalizedDetails(
  path: string,
): Promise<{ viDetails: any | null; enDetails: any | null }> {
  const [viResult, enResult] = await Promise.allSettled([
    fetchTmdb<any>(path, {
      language: "vi-VN",
    }),
    fetchTmdb<any>(path, {
      language: "en-US",
    }),
  ]);

  return {
    viDetails: viResult.status === "fulfilled" ? viResult.value : null,
    enDetails: enResult.status === "fulfilled" ? enResult.value : null,
  };
}

function buildContextQuery(
  ctx: MovieScrapeContext | ShowScrapeContext,
  viTitle: string,
  originName: string,
  country: string,
): string {
  const query = new URLSearchParams();

  if (viTitle && viTitle.trim().length > 0) {
    query.set("title", viTitle.trim());
  }

  if (originName && originName.trim().length > 0) {
    query.set("originName", originName.trim());
  }

  if (
    typeof ctx.media?.releaseYear === "number" &&
    Number.isFinite(ctx.media.releaseYear)
  ) {
    query.set("releaseYear", String(ctx.media.releaseYear));
  } else if (ctx.media?.year) {
    query.set("releaseYear", String(ctx.media.year));
  }

  if (country && country.trim().length > 0) {
    query.set("country", country.trim());
  }

  const queryString = query.toString();
  return queryString ? `?${queryString}` : "";
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

  let viTitle = ctx.media.title;
  let originName = "";
  let country = "";

  try {
    const { viDetails, enDetails } = await fetchTmdbLocalizedDetails(
      `/movie/${ctx.media.tmdbId}`,
    );
    if (viDetails || enDetails) {
      viTitle = viDetails?.title || enDetails?.title || viTitle;
      originName =
        enDetails?.title ||
        viDetails?.original_title ||
        enDetails?.original_title ||
        "";
      country =
        viDetails?.origin_country?.[0] ||
        viDetails?.production_countries?.[0]?.iso_3166_1 ||
        enDetails?.origin_country?.[0] ||
        enDetails?.production_countries?.[0]?.iso_3166_1 ||
        "";
    }
  } catch (err) {
    console.error("[KKPhim] Failed to fetch TMDB movie aliases:", err);
  }

  const apiUrl = `${KKPHIM_API_BASE}/movie/${ctx.media.tmdbId}${buildContextQuery(ctx, viTitle, originName, country)}`;

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

  let viTitle = ctx.media.title;
  let originName = "";
  let country = "";

  try {
    const { viDetails, enDetails } = await fetchTmdbLocalizedDetails(
      `/tv/${ctx.media.tmdbId}`,
    );
    if (viDetails || enDetails) {
      viTitle = viDetails?.name || enDetails?.name || viTitle;
      originName =
        enDetails?.name ||
        viDetails?.original_name ||
        enDetails?.original_name ||
        "";
      country =
        viDetails?.origin_country?.[0] || enDetails?.origin_country?.[0] || "";
    }
  } catch (err) {
    console.error("[KKPhim] Failed to fetch TMDB show aliases:", err);
  }

  const apiUrl = `${KKPHIM_API_BASE}/tv/${ctx.media.tmdbId}/${ctx.media.season.number}/${ctx.media.episode.number}${buildContextQuery(ctx, viTitle, originName, country)}`;

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
