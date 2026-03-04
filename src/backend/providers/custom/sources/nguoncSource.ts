import {
  type MovieScrapeContext,
  NotFoundError,
  type ShowScrapeContext,
  type SourcererOutput,
  flags,
} from "@p-stream/providers";

const NGUONC_API_BASE = "https://phim.nguonc.com/api";
const TMDB_API_KEY = "a500049f3e06109fe3e8289b06cf5685";

// Lấy tên tiếng Việt từ TMDB để tìm kiếm trên NguonC
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

interface NguonCEpisodeItem {
  name: string;
  slug: string;
  embed: string;
  m3u8: string;
}

interface NguonCServerData {
  server_name: string;
  items: NguonCEpisodeItem[];
}

interface NguonCSearchItem {
  name: string;
  original_name: string;
  slug: string;
  description?: string;
}

// Tìm slug phim trên NguonC bằng cách search + match Tên và Năm/Season
async function findNguonCSlug(
  ctx: MovieScrapeContext | ShowScrapeContext,
): Promise<string> {
  const searchTerms: string[] = [ctx.media.title];

  // Thử lấy tên tiếng Việt
  const viTitle = await fetchVietnameseTitle(ctx.media.tmdbId, ctx.media.type);
  if (viTitle && viTitle !== ctx.media.title) {
    searchTerms.unshift(viTitle);
  }

  for (const term of searchTerms) {
    const searchUrl = `${NGUONC_API_BASE}/films/search?keyword=${encodeURIComponent(term)}`;
    try {
      const response = await fetch(searchUrl);
      const data = (await response.json()) as {
        status: string;
        items: NguonCSearchItem[];
      };

      if (!data?.items?.length) continue;

      for (const item of data.items) {
        const clean = (t: string) =>
          t
            .toLowerCase()
            .replace(/\s*\(?(phần|season|phân)\s*\d+\)?/gi, "")
            .replace(/[-\s]/g, "")
            .trim();

        const targetTitle = clean(ctx.media.title);
        const itemOriginTitle = clean(item.original_name);
        const itemNameTitle = clean(item.name);

        const titleMatches =
          itemOriginTitle.includes(targetTitle) ||
          targetTitle.includes(itemOriginTitle) ||
          itemNameTitle.includes(targetTitle) ||
          targetTitle.includes(itemNameTitle);

        if (titleMatches) {
          if (ctx.media.type === "movie") {
            // NguonC thường để năm trong tên hoặc original_name
            const yearStr = String(ctx.media.releaseYear);
            if (
              item.name.includes(yearStr) ||
              item.original_name.includes(yearStr)
            ) {
              return item.slug;
            }
          } else {
            // Đối với show, match season từ tên
            const showCtx = ctx as ShowScrapeContext;
            const seasonNum = showCtx.media.season.number;
            const seasonPattern = new RegExp(
              `(?:phần|season|p)\\s*${seasonNum}\\b`,
              "i",
            );

            if (
              seasonPattern.test(item.name) ||
              seasonPattern.test(item.original_name)
            ) {
              return item.slug;
            }

            // Fallback: nếu season 1, có thể không ghi phần
            if (
              seasonNum === 1 &&
              !/(?:phần|season|p)\s*\d+/i.test(item.name) &&
              !/(?:phần|season|p)\s*\d+/i.test(item.original_name)
            ) {
              return item.slug;
            }
          }
        }
      }
    } catch {
      continue;
    }
  }

  throw new NotFoundError("Could not find matching movie on NguonC");
}

// Lấy chi tiết phim và extract stream URL
async function getNguonCStreams(
  ctx: MovieScrapeContext | ShowScrapeContext,
  slug: string,
): Promise<SourcererOutput> {
  const detailUrl = `${NGUONC_API_BASE}/film/${slug}`;
  const response = await fetch(detailUrl);
  const detail = (await response.json()) as {
    status: string;
    movie: {
      episodes: NguonCServerData[];
    };
  };

  const episodes = detail?.movie?.episodes;
  if (!episodes?.length) {
    throw new NotFoundError("No episodes found on NguonC");
  }

  // Chọn server đầu tiên có dữ liệu
  const server = episodes.find((s) => s.items?.length > 0);
  if (!server) {
    throw new NotFoundError("No server with episodes found on NguonC");
  }

  let episodeData: NguonCEpisodeItem | undefined;

  if (ctx.media.type === "movie") {
    episodeData = server.items[0];
  } else {
    const showCtx = ctx as ShowScrapeContext;
    const episodeNumber = showCtx.media.episode.number;

    // Tìm tập theo tên hoặc slug
    episodeData = server.items.find((ep) => {
      const name = ep.name.replace(/^Tập\s*/i, "").trim();
      return (
        name === String(episodeNumber) ||
        name === String(episodeNumber).padStart(2, "0") ||
        ep.slug.includes(`tap-${episodeNumber}`) ||
        ep.slug === String(episodeNumber)
      );
    });

    // Fallback: match bằng index
    if (!episodeData && episodeNumber <= server.items.length) {
      episodeData = server.items[episodeNumber - 1];
    }
  }

  if (!episodeData || (!episodeData.m3u8 && !episodeData.embed)) {
    throw new NotFoundError("Episode not found on NguonC");
  }

  const streams = [];
  if (episodeData.m3u8) {
    streams.push({
      id: "nguonc-hls",
      type: "hls" as const,
      playlist: episodeData.m3u8,
      flags: [flags.CORS_ALLOWED],
      captions: [],
      skipValidation: true,
      headers: {
        Referer: "https://phim.nguonc.com/",
        Origin: "https://phim.nguonc.com",
      },
    });
  }

  const embeds = [];
  if (episodeData.embed) {
    embeds.push({
      embedId: "nguonc-embed",
      url: episodeData.embed,
    });
  }

  return {
    stream: streams,
    embeds: embeds,
  };
}

export async function scrapeNguoncMovie(
  ctx: MovieScrapeContext,
): Promise<SourcererOutput> {
  ctx.progress(10);
  const slug = await findNguonCSlug(ctx);
  ctx.progress(50);
  const result = await getNguonCStreams(ctx, slug);
  ctx.progress(100);
  return result;
}

export async function scrapeNguoncShow(
  ctx: ShowScrapeContext,
): Promise<SourcererOutput> {
  ctx.progress(10);
  const slug = await findNguonCSlug(ctx);
  ctx.progress(50);
  const result = await getNguonCStreams(ctx, slug);
  ctx.progress(100);
  return result;
}
