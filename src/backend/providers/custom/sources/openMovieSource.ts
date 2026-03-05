import {
  type MovieScrapeContext,
  NotFoundError,
  type ShowScrapeContext,
  type SourcererOutput,
} from "@p-stream/providers";

const getBaseUrl = () => {
  const envUrl =
    import.meta.env.VITE_TMDB_EMBED_API_URL || "http://localhost:8787";
  if (envUrl.startsWith("/") && typeof window !== "undefined") {
    return window.location.origin + envUrl;
  }
  return envUrl;
};

const OPENMOVIE_API_BASE = `${getBaseUrl()}/api/streams`;

interface OpenMovieStream {
  name: string;
  title: string;
  url: string;
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

// Encode stream info into URL for the embed scraper to parse
function encodeStreamInfo(stream: OpenMovieStream): string {
  const info = {
    name: stream.name,
    title: stream.title,
    url: stream.url,
    quality: stream.quality,
    provider: stream.provider,
  };
  return `openmovie://${encodeURIComponent(JSON.stringify(info))}`;
}

export async function scrapeOpenMovieMovie(
  ctx: MovieScrapeContext,
): Promise<SourcererOutput> {
  console.info("[OpenMovie] Starting Movie Scrape for TMDB:", ctx.media.tmdbId);
  ctx.progress(10);

  const apiUrl = `${OPENMOVIE_API_BASE}/movie/${ctx.media.tmdbId}`;
  console.info("[OpenMovie] Fetching from API:", apiUrl);

  try {
    const data = await ctx.fetcher<OpenMovieApiResponse>(apiUrl);
    console.info("[OpenMovie] API Response:", data);

    if (!data.success || !data.streams?.length) {
      console.warn("[OpenMovie] No streams found or success is false");
      throw new NotFoundError("No streams found on OpenMovie");
    }

    // Map each stream to an embed entry
    const embeds = data.streams.map((stream) => ({
      embedId: "openmovie-embed",
      url: encodeStreamInfo(stream),
    }));

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
  console.info(
    `[OpenMovie] Starting Show Scrape for TMDB: ${ctx.media.tmdbId} (S${ctx.media.season.number}E${ctx.media.episode.number})`,
  );
  ctx.progress(10);

  const apiUrl = `${OPENMOVIE_API_BASE}/series/${ctx.media.tmdbId}?season=${ctx.media.season.number}&episode=${ctx.media.episode.number}`;
  console.info(
    `[OpenMovie] Show: Fetching from API: ${apiUrl} (S${ctx.media.season.number}E${ctx.media.episode.number})`,
  );

  try {
    const data = await ctx.fetcher<OpenMovieApiResponse>(apiUrl);
    console.info("[OpenMovie] API Response:", data);

    if (!data.success || !data.streams?.length) {
      throw new NotFoundError("No streams found on OpenMovie");
    }

    const embeds = data.streams.map((stream) => ({
      embedId: "openmovie-embed",
      url: encodeStreamInfo(stream),
    }));

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
