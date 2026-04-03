import {
  type MovieScrapeContext,
  NotFoundError,
  type ShowScrapeContext,
  type SourcererOutput,
  flags,
} from "@/lib/providers";

const OPHIM_API_BASE = "https://ophim1.com/v1/api";
const TMDB_API_KEY = "a500049f3e06109fe3e8289b06cf5685";

// Lấy tên tiếng Việt từ TMDB để tìm kiếm trên OPhim
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

interface OPhimSearchItem {
  name: string;
  origin_name: string;
  slug: string;
  type: string;
  year?: number;
}

interface OPhimEpisodeData {
  name: string;
  slug: string;
  link_embed: string;
  link_m3u8: string;
}

interface OPhimServerData {
  server_name: string;
  server_data: OPhimEpisodeData[];
}

interface OPhimDetail {
  name: string;
  slug: string;
  type: string;
  tmdb?: {
    type?: string;
    id?: string;
    season?: number;
  };
  imdb?: {
    id?: string;
  };
  episodes: OPhimServerData[];
}

// Tìm slug phim trên OPhim bằng cách search + match TMDB ID
async function findOPhimSlug(
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
    const searchUrl = `${OPHIM_API_BASE}/tim-kiem?keyword=${encodeURIComponent(term)}`;
    try {
      const response = await fetch(searchUrl);
      const data = (await response.json()) as {
        status: string;
        data: { items: OPhimSearchItem[] };
      };

      if (!data?.data?.items?.length) continue;

      // Kiểm tra từng kết quả, lấy chi tiết để match TMDB ID
      for (const item of data.data.items) {
        const detailUrl = `${OPHIM_API_BASE}/phim/${item.slug}`;
        try {
          const responseDetail = await fetch(detailUrl);
          const detail = (await responseDetail.json()) as {
            status: string;
            data: { item: OPhimDetail };
          };

          const detailItem = detail?.data?.item;
          if (!detailItem?.tmdb?.id) continue;

          // Match bằng TMDB ID
          if (detailItem.tmdb.id === ctx.media.tmdbId) {
            // Nếu là show, kiểm tra season
            if (ctx.media.type === "show") {
              const showCtx = ctx as ShowScrapeContext;
              if (
                detailItem.tmdb.season !== undefined &&
                detailItem.tmdb.season !== showCtx.media.season.number
              ) {
                if (!potentialMatchSlug) {
                  potentialMatchSlug = item.slug;
                }
                continue;
              }
            }
            return item.slug;
          }
        } catch {
          // Bỏ qua lỗi chi tiết, thử item tiếp theo
        }
      }
    } catch {
      // Bỏ qua lỗi tìm kiếm, thử term tiếp theo
    }
  }

  if (potentialMatchSlug) {
    return potentialMatchSlug;
  }

  throw new NotFoundError("Could not find matching movie on OPhim");
}

// Lấy chi tiết phim và extract stream URL
async function getOPhimStreams(
  ctx: MovieScrapeContext | ShowScrapeContext,
  slug: string,
): Promise<SourcererOutput> {
  const detailUrl = `${OPHIM_API_BASE}/phim/${slug}`;
  const response = await fetch(detailUrl);
  const detail = (await response.json()) as {
    status: string;
    data: { item: OPhimDetail };
  };

  const item = detail?.data?.item;
  if (!item?.episodes?.length) {
    throw new NotFoundError("No episodes found on OPhim");
  }

  // Chọn server đầu tiên có dữ liệu
  const server = item.episodes.find((s) => s.server_data?.length > 0);
  if (!server) {
    throw new NotFoundError("No server with episodes found on OPhim");
  }

  let episodeData: OPhimEpisodeData | undefined;

  if (ctx.media.type === "movie") {
    // Movie: lấy episode đầu tiên (thường là "Full")
    episodeData = server.server_data[0];
  } else {
    // Show: tìm episode theo số
    const showCtx = ctx as ShowScrapeContext;
    const episodeNumber = showCtx.media.episode.number;

    episodeData = server.server_data.find(
      (ep) =>
        ep.name === String(episodeNumber) || ep.slug === String(episodeNumber),
    );

    // Fallback: thử match bằng index
    if (!episodeData && episodeNumber <= server.server_data.length) {
      episodeData = server.server_data[episodeNumber - 1];
    }
  }

  if (!episodeData) {
    throw new NotFoundError("Episode not found on OPhim");
  }

  const streams = [];

  // Ưu tiên link_m3u8 (stream trực tiếp, chất lượng tốt hơn)
  if (episodeData.link_m3u8) {
    streams.push({
      id: "ophim-hls",
      type: "hls" as const,
      playlist: episodeData.link_m3u8,
      flags: [flags.CORS_ALLOWED],
      captions: [],
      // OPhim streams không cần validation vì URL đã xác thực qua API
      skipValidation: true,
      headers: {
        Referer: "https://ophim16.cc/",
        Origin: "https://ophim16.cc",
      },
    });
  }

  if (streams.length === 0) {
    throw new NotFoundError("No streamable URL found on OPhim");
  }

  return {
    stream: streams,
    embeds: [],
  };
}

export async function scrapeOPhimMovie(
  ctx: MovieScrapeContext,
): Promise<SourcererOutput> {
  ctx.progress(10);

  const slug = await findOPhimSlug(ctx);
  ctx.progress(50);

  const result = await getOPhimStreams(ctx, slug);
  ctx.progress(100);

  return result;
}

export async function scrapeOPhimShow(
  ctx: ShowScrapeContext,
): Promise<SourcererOutput> {
  ctx.progress(10);

  const slug = await findOPhimSlug(ctx);
  ctx.progress(50);

  const result = await getOPhimStreams(ctx, slug);
  ctx.progress(100);

  return result;
}
