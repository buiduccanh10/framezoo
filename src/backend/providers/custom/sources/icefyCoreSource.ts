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

const ICEFY_CORE_API_BASE = `${getBaseUrl()}/api/streams/icefy-core`;

interface IcefyCoreStream {
  name: string;
  title: string;
  url: string;
  subtitle?: string;
  quality: string;
  provider: string;
  preview?: StreamPreview;
}

interface IcefyCoreApiResponse {
  success: boolean;
  tmdbId: string;
  imdbId: string | null;
  count: number;
  providerTimings: Record<string, number>;
  streams: IcefyCoreStream[];
}

function getCandidateTmdbIds(media: Record<string, any>): string[] {
  const tmdbId =
    typeof media?.tmdbId === "string" && media.tmdbId.trim().length > 0
      ? media.tmdbId.trim()
      : "";

  return /^\d+$/.test(tmdbId) ? [tmdbId] : [];
}

function mapStreamsToEmbeds(streams: IcefyCoreStream[]) {
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

function encodeStreamInfo(stream: IcefyCoreStream): string {
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

export async function scrapeIcefyCoreMovie(
  ctx: MovieScrapeContext,
): Promise<SourcererOutput> {
  ctx.progress(10);
  const candidateIds = getCandidateTmdbIds(ctx.media);

  try {
    if (!candidateIds.length) {
      throw new NotFoundError("Missing numeric TMDB id for Icefy Core");
    }

    for (const mediaId of candidateIds) {
      const apiUrls = [`${ICEFY_CORE_API_BASE}/movie/${mediaId}`];

      for (const apiUrl of apiUrls) {
        let data: IcefyCoreApiResponse | null = null;
        try {
          data = await ctx.fetcher<IcefyCoreApiResponse>(apiUrl, {
            credentials: "include",
          });
        } catch (error) {
          console.warn(
            `[Icefy Core] Movie request failed for ${apiUrl}`,
            error,
          );
          continue;
        }

        if (!data?.success || !data.streams?.length) {
          console.warn(
            `[Icefy Core] Empty movie response from ${apiUrl}`,
            JSON.stringify({
              success: data?.success ?? false,
              count: data?.count ?? 0,
              tmdbId: data?.tmdbId ?? mediaId,
            }),
          );
          continue;
        }

        ctx.progress(100);
        return {
          embeds: mapStreamsToEmbeds(data.streams),
        };
      }
    }
    throw new NotFoundError("No streams found on Icefy Core");
  } catch (err) {
    console.error("[Icefy Core] Scrape failed:", err);
    if (err instanceof NotFoundError) throw err;
    throw new NotFoundError("Failed to fetch streams from Icefy Core");
  }
}

export async function scrapeIcefyCoreShow(
  ctx: ShowScrapeContext,
): Promise<SourcererOutput> {
  ctx.progress(10);
  const candidateIds = getCandidateTmdbIds(ctx.media);

  try {
    if (!candidateIds.length) {
      throw new NotFoundError("Missing numeric TMDB id for Icefy Core");
    }

    for (const mediaId of candidateIds) {
      const apiUrls = [
        `${ICEFY_CORE_API_BASE}/tv/${mediaId}/${ctx.media.season.number}/${ctx.media.episode.number}`,
      ];

      for (const apiUrl of apiUrls) {
        let data: IcefyCoreApiResponse | null = null;
        try {
          data = await ctx.fetcher<IcefyCoreApiResponse>(apiUrl, {
            credentials: "include",
          });
        } catch (error) {
          console.warn(`[Icefy Core] Show request failed for ${apiUrl}`, error);
          continue;
        }

        if (!data?.success || !data.streams?.length) {
          console.warn(
            `[Icefy Core] Empty show response from ${apiUrl}`,
            JSON.stringify({
              success: data?.success ?? false,
              count: data?.count ?? 0,
              tmdbId: data?.tmdbId ?? mediaId,
              season: ctx.media.season.number,
              episode: ctx.media.episode.number,
            }),
          );
          continue;
        }

        ctx.progress(100);
        return {
          embeds: mapStreamsToEmbeds(data.streams),
        };
      }
    }
    throw new NotFoundError("No streams found on Icefy Core");
  } catch (err) {
    console.error("[Icefy Core] Show scrape failed:", err);
    if (err instanceof NotFoundError) throw err;
    throw new NotFoundError("Failed to fetch streams from Icefy Core");
  }
}
