import {
  type MovieScrapeContext,
  NotFoundError,
  type ShowScrapeContext,
  type SourcererOutput,
  type StreamPreview,
} from "../../../../lib/providers";

const getBaseUrl = () => {
  const backendUrl =
    import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";
  return `${backendUrl}/api/embed`;
};

const VIDSRC_API_BASE = `${getBaseUrl()}/api/streams/vidsrc`;

interface VidSrcStream {
  name: string;
  title: string;
  url: string;
  subtitle?: string;
  quality: string;
  provider: string;
  preview?: StreamPreview;
}

interface VidSrcApiResponse {
  success: boolean;
  tmdbId: string;
  imdbId: string | null;
  count: number;
  providerTimings: Record<string, number>;
  streams: VidSrcStream[];
}

function getCandidateIds(media: Record<string, any>): string[] {
  const tmdbId =
    typeof media?.tmdbId === "string" && media.tmdbId.trim().length > 0
      ? media.tmdbId.trim()
      : "";
  const imdbId =
    typeof media?.imdbId === "string" && media.imdbId.trim().length > 0
      ? media.imdbId.trim()
      : "";

  return Array.from(new Set([tmdbId, imdbId].filter(Boolean)));
}

function mapStreamsToEmbeds(streams: VidSrcStream[]) {
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

function encodeStreamInfo(stream: VidSrcStream): string {
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

export async function scrapeVidSrcMovie(
  ctx: MovieScrapeContext,
): Promise<SourcererOutput> {
  ctx.progress(10);
  const candidateIds = getCandidateIds(ctx.media);

  try {
    for (const mediaId of candidateIds) {
      const apiUrl = `${VIDSRC_API_BASE}/movie/${mediaId}`;
      const data = await ctx.fetcher<VidSrcApiResponse>(apiUrl, {
        credentials: "include",
      });

      if (!data.success || !data.streams?.length) {
        continue;
      }

      ctx.progress(100);
      return {
        embeds: mapStreamsToEmbeds(data.streams),
      };
    }
    throw new NotFoundError("No streams found on VidSrc");
  } catch (err) {
    console.error("[VidSrc] Scrape failed:", err);
    if (err instanceof NotFoundError) throw err;
    throw new NotFoundError("Failed to fetch streams from VidSrc");
  }
}

export async function scrapeVidSrcShow(
  ctx: ShowScrapeContext,
): Promise<SourcererOutput> {
  ctx.progress(10);
  const candidateIds = getCandidateIds(ctx.media);

  try {
    for (const mediaId of candidateIds) {
      const apiUrl = `${VIDSRC_API_BASE}/tv/${mediaId}/${ctx.media.season.number}/${ctx.media.episode.number}`;
      const data = await ctx.fetcher<VidSrcApiResponse>(apiUrl, {
        credentials: "include",
      });

      if (!data.success || !data.streams?.length) {
        continue;
      }

      ctx.progress(100);
      return {
        embeds: mapStreamsToEmbeds(data.streams),
      };
    }
    throw new NotFoundError("No streams found on VidSrc");
  } catch (err) {
    console.error("[VidSrc] Show scrape failed:", err);
    if (err instanceof NotFoundError) throw err;
    throw new NotFoundError("Failed to fetch streams from VidSrc");
  }
}
