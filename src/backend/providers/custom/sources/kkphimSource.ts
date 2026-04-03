import {
  type MovieScrapeContext,
  NotFoundError,
  type ShowScrapeContext,
  type SourcererOutput,
  flags,
} from "@/lib/providers";

const KKPHIM_API_BASE = "https://phimapi.com";
const TMDB_API_KEY = "a500049f3e06109fe3e8289b06cf5685";

// Lấy tên tiếng Việt từ TMDB để tìm kiếm trên KKPhim
async function fetchVietnameseTitle(
  tmdbId: string,
  type: "movie" | "show",
): Promise<string | null> {
  try {
    const mediaType = type === "movie" ? "movie" : "tv";
    const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=vi-VN`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return type === "movie" ? data.title : data.name;
  } catch {
    return null;
  }
}

interface KKPhimEpisodeData {
  name: string;
  slug: string;
  link_embed: string;
  link_m3u8: string;
}

interface KKPhimServerData {
  server_name: string;
  server_data: KKPhimEpisodeData[];
}

interface KKPhimDetail {
  name: string;
  origin_name: string;
  slug: string;
  type: string;
  year?: number;
  tmdb?: {
    type?: string;
    id?: string | number | null;
    season?: number | null;
  };
  episodes: KKPhimServerData[];
}

interface KKPhimSearchItem {
  name: string;
  origin_name: string;
  slug: string;
  type: string;
  year?: number;
}

// Tìm slug phim trên KKPhim bằng cách search + match TMDB ID hoặc Tên
async function findKKPhimSlug(
  ctx: MovieScrapeContext | ShowScrapeContext,
): Promise<string> {
  const searchTerms: string[] = [ctx.media.title];

  // Thử lấy tên tiếng Việt
  const viTitle = await fetchVietnameseTitle(ctx.media.tmdbId, ctx.media.type);
  if (viTitle && viTitle !== ctx.media.title) {
    searchTerms.unshift(viTitle);
  }

  let potentialMatchSlug: string | null = null;

  for (const term of searchTerms) {
    const searchUrl = `${KKPHIM_API_BASE}/v1/api/tim-kiem?keyword=${encodeURIComponent(term)}`;
    try {
      const response = await fetch(searchUrl);
      const data = (await response.json()) as {
        status: string;
        data: { items: KKPhimSearchItem[] };
      };

      if (!data?.data?.items?.length) continue;

      for (const item of data.data.items) {
        // Lấy chi tiết để match TMDB ID
        const detailUrl = `${KKPHIM_API_BASE}/phim/${item.slug}`;
        try {
          const responseDetail = await fetch(detailUrl);
          const detail = (await responseDetail.json()) as {
            status: boolean;
            movie: KKPhimDetail;
          };

          const movie = detail?.movie;
          if (!movie) continue;

          // 1. Match bằng TMDB ID nếu có
          const isMatch =
            movie.tmdb?.id && String(movie.tmdb.id) === ctx.media.tmdbId;

          if (isMatch) {
            if (ctx.media.type === "show") {
              const showCtx = ctx as ShowScrapeContext;
              if (
                movie.tmdb?.season != null &&
                movie.tmdb.season !== showCtx.media.season.number
              ) {
                if (!potentialMatchSlug) {
                  potentialMatchSlug = item.slug;
                }
                continue;
              }
            }
            return item.slug;
          }

          // 2. Fallback: Match bằng tên và năm nếu không có TMDB ID
          const clean = (t: string) =>
            t
              .toLowerCase()
              .replace(/\s*\(?(phần|season|phân)\s*\d+\)?/gi, "")
              .trim();
          const targetTitle = clean(ctx.media.title);
          const itemOriginTitle = clean(item.origin_name);
          const itemNameTitle = clean(item.name);

          if (
            itemOriginTitle.includes(targetTitle) ||
            targetTitle.includes(itemOriginTitle) ||
            itemNameTitle.includes(targetTitle) ||
            targetTitle.includes(itemNameTitle)
          ) {
            if (ctx.media.type === "movie") {
              if (item.year === ctx.media.releaseYear) {
                return item.slug;
              }
            } else {
              // Đối với show, match season từ tên nếu có
              const showCtx = ctx as ShowScrapeContext;
              const extractSeason = (s: string) => {
                const m = s.match(/(?:phần|season)\s*(\d+)/i);
                return m ? parseInt(m[1], 10) : null;
              };
              const seasonNum =
                extractSeason(item.name) || extractSeason(item.origin_name);
              if (seasonNum === showCtx.media.season.number) {
                return item.slug;
              }
            }
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  if (potentialMatchSlug) {
    return potentialMatchSlug;
  }

  throw new NotFoundError("Could not find matching movie on KKPhim");
}

// Lấy chi tiết phim và extract stream URL
async function getKKPhimStreams(
  ctx: MovieScrapeContext | ShowScrapeContext,
  slug: string,
): Promise<SourcererOutput> {
  const detailUrl = `${KKPHIM_API_BASE}/phim/${slug}`;
  const response = await fetch(detailUrl);
  const detail = (await response.json()) as {
    status: boolean;
    episodes: KKPhimServerData[];
  };

  const episodes = detail?.episodes;
  if (!episodes?.length) {
    throw new NotFoundError("No episodes found on KKPhim");
  }

  // Chọn server đầu tiên có dữ liệu
  const server = episodes.find((s) => s.server_data?.length > 0);
  if (!server) {
    throw new NotFoundError("No server with episodes found on KKPhim");
  }

  let episodeData: KKPhimEpisodeData | undefined;

  if (ctx.media.type === "movie") {
    episodeData = server.server_data[0];
  } else {
    const showCtx = ctx as ShowScrapeContext;
    const episodeNumber = showCtx.media.episode.number;

    // Tìm tập theo số (Tập 1, 1, tap-1, ...)
    episodeData = server.server_data.find((ep) => {
      const name = ep.name.replace(/^Tập\s*/i, "").trim();
      return (
        name === String(episodeNumber) ||
        name === String(episodeNumber).padStart(2, "0") ||
        ep.slug.includes(`tap-${episodeNumber}`) ||
        ep.slug === String(episodeNumber)
      );
    });

    // Fallback: match bằng index
    if (!episodeData && episodeNumber <= server.server_data.length) {
      episodeData = server.server_data[episodeNumber - 1];
    }
  }

  if (!episodeData || (!episodeData.link_m3u8 && !episodeData.link_embed)) {
    throw new NotFoundError("Episode not found on KKPhim");
  }

  const streams = [];
  if (episodeData.link_m3u8) {
    streams.push({
      id: "kkphim-hls",
      type: "hls" as const,
      playlist: episodeData.link_m3u8,
      flags: [flags.CORS_ALLOWED],
      captions: [],
      skipValidation: true,
      headers: {
        Referer: "https://phimapi.com/",
        Origin: "https://phimapi.com",
      },
    });
  }

  const embeds = [];
  if (episodeData.link_embed) {
    embeds.push({
      embedId: "kkphim-embed",
      url: episodeData.link_embed,
    });
  }

  return {
    stream: streams,
    embeds: embeds,
  };
}

export async function scrapeKKPhimMovie(
  ctx: MovieScrapeContext,
): Promise<SourcererOutput> {
  ctx.progress(10);
  const slug = await findKKPhimSlug(ctx);
  ctx.progress(50);
  const result = await getKKPhimStreams(ctx, slug);
  ctx.progress(100);
  return result;
}

export async function scrapeKKPhimShow(
  ctx: ShowScrapeContext,
): Promise<SourcererOutput> {
  ctx.progress(10);
  const slug = await findKKPhimSlug(ctx);
  ctx.progress(50);
  const result = await getKKPhimStreams(ctx, slug);
  ctx.progress(100);
  return result;
}
