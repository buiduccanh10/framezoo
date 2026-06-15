import { getProviderNames } from '../../providers/registry';
import { tmdb, tmdbUtils } from '../../utils/tmdb';

type StreamItem = {
  url?: string;
};

type StreamsPayload = {
  streams?: StreamItem[];
};

type TvShowDetails = {
  last_episode_to_air?: {
    season_number?: number;
    episode_number?: number;
  } | null;
  seasons?: Array<{
    season_number?: number;
    episode_count?: number;
  }> | null;
};

// 0 means "warm all collected movie ids"
const STREAM_WARMUP_LIMIT = Number(process.env.STREAM_WARMUP_LIMIT || 0);
const STREAM_WARMUP_TARGET_SECONDS = Number(process.env.STREAM_WARMUP_TARGET_SECONDS || 30);
const STREAM_WARMUP_MAX_SEGMENTS = Number(process.env.STREAM_WARMUP_MAX_SEGMENTS || 12);
const PREVIEW_WARMUP_ENABLED = process.env.PREVIEW_WARMUP_ENABLED !== 'false';
const PREVIEW_WARMUP_LIMIT = Number(process.env.PREVIEW_WARMUP_LIMIT || 0);
const PREVIEW_WARMUP_TIMEOUT_MS = Number(process.env.PREVIEW_WARMUP_TIMEOUT_MS || 20_000);
const PREVIEW_WARMUP_PROVIDERS = (
  process.env.PREVIEW_WARMUP_PROVIDERS || getProviderNames().join(',')
)
  .split(',')
  .map(provider => provider.trim().toLowerCase())
  .filter(Boolean);
const PREVIEW_WARMUP_TV_ENABLED = process.env.PREVIEW_WARMUP_TV_ENABLED !== 'false';
const PREVIEW_WARMUP_TV_SHOW_LIMIT = Number(
  process.env.PREVIEW_WARMUP_TV_SHOW_LIMIT || PREVIEW_WARMUP_LIMIT || 0
);
const PREVIEW_WARMUP_TV_EPISODES_PER_SHOW = Math.max(
  1,
  Number(process.env.PREVIEW_WARMUP_TV_EPISODES_PER_SHOW || 2)
);
const EMBED_BASE_URL = process.env.CRAWLER_EMBED_BASE_URL || 'http://127.0.0.1:3000';
const TMDB_CATALOG_CACHE_TTL = Number(process.env.TMDB_CATALOG_CACHE_TTL || 30 * 24 * 60 * 60);

const ts = () => new Date().toISOString();
const log = (msg: string) => console.log(`[${ts()}] [TMDB Crawler] ${msg}`);
const logWarn = (msg: string, err?: unknown) => console.warn(`[${ts()}] [TMDB Crawler] ${msg}`, err);

const resolveUrl = (base: string, value: string) => {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
};

const extractM3u8MediaLines = (playlist: string) =>
  playlist
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

type PlaylistEntry = {
  uri: string;
  durationSec: number | null;
};

const parseM3u8Entries = (playlist: string): PlaylistEntry[] => {
  const lines = playlist.split('\n').map(line => line.trim());
  const entries: PlaylistEntry[] = [];
  let pendingDuration: number | null = null;

  for (const line of lines) {
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const raw = line.slice('#EXTINF:'.length).split(',')[0];
      const parsed = Number(raw);
      pendingDuration = Number.isFinite(parsed) ? parsed : null;
      continue;
    }

    if (line.startsWith('#')) continue;

    entries.push({
      uri: line,
      durationSec: pendingDuration,
    });
    pendingDuration = null;
  }

  return entries;
};

const toLocalEmbedUrl = (rawUrl: string) => {
  try {
    const appBase = new URL(EMBED_BASE_URL);
    const parsed = new URL(rawUrl, EMBED_BASE_URL);
    if (parsed.pathname.startsWith('/api/embed/')) {
      parsed.protocol = appBase.protocol;
      parsed.host = appBase.host;
      return parsed.toString();
    }
    if (parsed.pathname.startsWith('/ts-proxy')) {
      parsed.pathname = `/api/embed${parsed.pathname}`;
      parsed.protocol = appBase.protocol;
      parsed.host = appBase.host;
      return parsed.toString();
    }
  } catch {
    // fall through
  }
  return rawUrl;
};

const fetchText = async (url: string) => {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return {
    contentType: response.headers.get('content-type') || '',
    text: await response.text(),
  };
};
const isLikelyM3U8 = (value: string) => /\.m3u8(\?|$)/i.test(value);

const fetchWithTimeout = async (url: string, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { method: 'GET', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const toUniqueIds = (ids: number[]) => [...new Set(ids)].filter(Boolean);

const warmTsProxyFromPlaylist = async (localProxyUrl: string, maxSegments: number) => {
  const root = new URL(localProxyUrl);
  const sourceUrl = root.searchParams.get('url');
  if (!sourceUrl) return 0;

  // Avoid decoding massive direct media files (mp4/ts/...) as text.
  // Prewarm flow currently targets HLS playlists only.
  if (!isLikelyM3U8(sourceUrl)) {
    log(`Skip prewarm (non-HLS source): ${sourceUrl}`);
    return 0;
  }

  const playlistResponse = await fetchText(root.toString());
  if (!/mpegurl|m3u8/i.test(playlistResponse.contentType) && !playlistResponse.text.includes('#EXTM3U')) {
    return 0;
  }

  const firstLevelEntries = parseM3u8Entries(playlistResponse.text);
  if (!firstLevelEntries.length) return 0;

  const firstLevelAbsolute = firstLevelEntries.map(item => ({
    uri: resolveUrl(sourceUrl, item.uri),
    durationSec: item.durationSec,
  }));
  const firstLevelPlaylist = firstLevelAbsolute.find(item => /\.m3u8(\?|$)/i.test(item.uri));
  let segmentCandidates = firstLevelAbsolute.filter(item => !/\.m3u8(\?|$)/i.test(item.uri));

  if (firstLevelPlaylist) {
    const subPlaylistUrl = new URL(root.toString());
    subPlaylistUrl.searchParams.set('url', firstLevelPlaylist.uri);
    const subPlaylistResponse = await fetchText(subPlaylistUrl.toString());
    const secondLevelEntries = parseM3u8Entries(subPlaylistResponse.text);
    const subSourceUrl = subPlaylistUrl.searchParams.get('url') || firstLevelPlaylist.uri;
    segmentCandidates = secondLevelEntries
      .map(item => ({
        uri: resolveUrl(subSourceUrl, item.uri),
        durationSec: item.durationSec,
      }))
      .filter(item => !/\.m3u8(\?|$)/i.test(item.uri));
  }

  const targetSeconds = Math.max(1, STREAM_WARMUP_TARGET_SECONDS);
  const hardLimit = Math.max(1, maxSegments);
  const selected: PlaylistEntry[] = [];
  let accumulatedSeconds = 0;

  for (const candidate of segmentCandidates) {
    selected.push(candidate);
    accumulatedSeconds += candidate.durationSec ?? 2;
    if (accumulatedSeconds >= targetSeconds || selected.length >= hardLimit) {
      break;
    }
  }

  let warmed = 0;
  for (const segment of selected) {
    try {
      const segmentProxyUrl = new URL(root.toString());
      segmentProxyUrl.searchParams.set('url', segment.uri);
      const r = await fetch(segmentProxyUrl.toString(), { method: 'GET' });
      if (r.ok) warmed++;
    } catch (error) {
      logWarn(`Failed to warm segment: ${segment.uri}`, error);
    }
  }

  return warmed;
};

const warmMovieStreamCache = async (movieIds: number[]) => {
  const uniqueIds = toUniqueIds(movieIds);
  const picked =
    STREAM_WARMUP_LIMIT > 0 ? uniqueIds.slice(0, STREAM_WARMUP_LIMIT) : uniqueIds;
  if (!picked.length) return;

  log(`Starting stream prewarm for ${picked.length} titles`);
  for (const tmdbId of picked) {
    try {
      const streamsUrl = `${EMBED_BASE_URL}/api/embed/api/streams/vixsrc/movie/${tmdbId}`;
      const payload = await $fetch<StreamsPayload>(streamsUrl, {
        method: 'GET',
        timeout: 20000,
      });

      const proxyUrl = (payload?.streams || [])
        .map(item => item?.url)
        .find(url => typeof url === 'string' && url.includes('ts-proxy'));

      if (!proxyUrl) {
        log(`No ts-proxy stream for movie ${tmdbId}`);
        continue;
      }

      const localProxyUrl = toLocalEmbedUrl(proxyUrl);
      const warmed = await warmTsProxyFromPlaylist(localProxyUrl, STREAM_WARMUP_MAX_SEGMENTS);
      log(`Warmed ${warmed} segments for movie ${tmdbId}`);
    } catch (error) {
      logWarn(`Prewarm failed for movie ${tmdbId}`, error);
    }
  }
};

const warmMoviePreviewCache = async (movieIds: number[]) => {
  if (!PREVIEW_WARMUP_ENABLED) {
    return;
  }

  const uniqueIds = toUniqueIds(movieIds);
  const picked =
    PREVIEW_WARMUP_LIMIT > 0 ? uniqueIds.slice(0, PREVIEW_WARMUP_LIMIT) : uniqueIds;
  if (!picked.length) return;

  const providers = PREVIEW_WARMUP_PROVIDERS.length ? PREVIEW_WARMUP_PROVIDERS : ['vixsrc'];
  log(`Starting preview prewarm for ${picked.length} titles`);

  for (const tmdbId of picked) {
    let warmed = false;

    for (const provider of providers) {
      const previewUrl =
        `${EMBED_BASE_URL}/api/embed/api/preview/auto` +
        `?provider=${encodeURIComponent(provider)}&type=movie&tmdbId=${tmdbId}`;

      try {
        const response = await fetchWithTimeout(previewUrl, PREVIEW_WARMUP_TIMEOUT_MS);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const vttPayload = await response.text();
        if (!vttPayload.includes('WEBVTT')) {
          throw new Error('Invalid preview payload');
        }

        warmed = true;
        log(`Preview warmed for movie ${tmdbId} via ${provider}`);
        break;
      } catch (error) {
        logWarn(`Preview prewarm failed for movie ${tmdbId} via ${provider}`, error);
      }
    }

    if (!warmed) {
      log(`No preview was warmed for movie ${tmdbId}`);
    }
  }
};

const pushEpisodeCandidate = (
  candidates: Array<{ season: number; episode: number }>,
  seasonInput: unknown,
  episodeInput: unknown
) => {
  const season = Number(seasonInput);
  const episode = Number(episodeInput);
  if (!Number.isInteger(season) || !Number.isInteger(episode)) return;
  if (season <= 0 || episode <= 0) return;
  if (candidates.some(item => item.season === season && item.episode === episode)) return;

  candidates.push({ season, episode });
};

const resolveTvEpisodeCandidates = async (tmdbId: number, language: string) => {
  const candidates: Array<{ season: number; episode: number }> = [];
  // Pilot is a good default fallback for newly discovered shows.
  pushEpisodeCandidate(candidates, 1, 1);

  try {
    const details = (await tmdb.tvShows.details(tmdbId, {
      language,
    } as any)) as TvShowDetails;

    pushEpisodeCandidate(
      candidates,
      details?.last_episode_to_air?.season_number,
      details?.last_episode_to_air?.episode_number
    );

    const seasons = Array.isArray(details?.seasons) ? details.seasons : [];
    const sortedSeasons = seasons
      .map(item => ({
        season: Number(item?.season_number),
        episodes: Number(item?.episode_count),
      }))
      .filter(
        item =>
          Number.isInteger(item.season) &&
          Number.isInteger(item.episodes) &&
          item.season > 0 &&
          item.episodes > 0
      )
      .sort((a, b) => b.season - a.season);
    const latestSeason = sortedSeasons[0];

    if (latestSeason) {
      pushEpisodeCandidate(candidates, latestSeason.season, 1);
      pushEpisodeCandidate(candidates, latestSeason.season, latestSeason.episodes);
    }

    // If requested, keep filling with latest seasons/episodes first.
    if (candidates.length < PREVIEW_WARMUP_TV_EPISODES_PER_SHOW) {
      for (const season of sortedSeasons) {
        for (let episode = season.episodes; episode >= 1; episode--) {
          pushEpisodeCandidate(candidates, season.season, episode);
          if (candidates.length >= PREVIEW_WARMUP_TV_EPISODES_PER_SHOW) {
            break;
          }
        }
        if (candidates.length >= PREVIEW_WARMUP_TV_EPISODES_PER_SHOW) {
          break;
        }
      }
    }
  } catch (error) {
    logWarn(`Failed to resolve TV episode candidates for show ${tmdbId}`, error);
  }

  return candidates.slice(0, PREVIEW_WARMUP_TV_EPISODES_PER_SHOW);
};

const warmTvPreviewCache = async (showIds: number[], language: string) => {
  if (!PREVIEW_WARMUP_ENABLED || !PREVIEW_WARMUP_TV_ENABLED) {
    return;
  }

  const uniqueIds = toUniqueIds(showIds);
  const picked =
    PREVIEW_WARMUP_TV_SHOW_LIMIT > 0
      ? uniqueIds.slice(0, PREVIEW_WARMUP_TV_SHOW_LIMIT)
      : uniqueIds;
  if (!picked.length) return;

  const providers = PREVIEW_WARMUP_PROVIDERS.length ? PREVIEW_WARMUP_PROVIDERS : ['vixsrc'];
  log(`Starting TV preview prewarm for ${picked.length} shows`);

  for (const tmdbId of picked) {
    const episodeCandidates = await resolveTvEpisodeCandidates(tmdbId, language);
    if (!episodeCandidates.length) {
      log(`No TV episode candidates for show ${tmdbId}`);
      continue;
    }

    let warmedCount = 0;
    for (const candidate of episodeCandidates) {
      let episodeWarmed = false;

      for (const provider of providers) {
        const previewUrl =
          `${EMBED_BASE_URL}/api/embed/api/preview/auto` +
          `?provider=${encodeURIComponent(provider)}&type=tv&tmdbId=${tmdbId}` +
          `&season=${candidate.season}&episode=${candidate.episode}`;

        try {
          const response = await fetchWithTimeout(previewUrl, PREVIEW_WARMUP_TIMEOUT_MS);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const vttPayload = await response.text();
          if (!vttPayload.includes('WEBVTT')) {
            throw new Error('Invalid preview payload');
          }

          episodeWarmed = true;
          warmedCount++;
          log(
            `Preview warmed for TV ${tmdbId} S${candidate.season}E${candidate.episode} via ${provider}`
          );
          break;
        } catch (error) {
          logWarn(
            `Preview prewarm failed for TV ${tmdbId} S${candidate.season}E${candidate.episode} via ${provider}`,
            error
          );
        }
      }

      if (!episodeWarmed) {
        log(`No preview was warmed for TV ${tmdbId} S${candidate.season}E${candidate.episode}`);
      }
    }

    if (!warmedCount) {
      log(`No TV previews were warmed for show ${tmdbId}`);
    }
  }
};

export default defineTask({
  meta: {
    name: 'jobs:tmdb-crawler',
    description: 'Crawl metadata from TMDB and cache it in storage',
  },
  async run() {
    console.log('[TMDB Crawler] Starting multi-language crawl...');
    const languages = [
      { code: 'vi', tmdb: 'vi-VN' },
      { code: 'en', tmdb: 'en-US' },
    ];

    try {
      const storage = useStorage('cache');

      for (const lang of languages) {
        console.log(`[TMDB Crawler] Crawling metadata for ${lang.code}...`);

        // Fetch genres
        const movieGenres = await tmdb.genres.movies({ language: lang.tmdb as any });
        const tvGenres = await tmdb.genres.tvShows({ language: lang.tmdb as any });

        // Popular
        const popularMovies = await tmdb.movies.popular({ language: lang.tmdb as any });
        const popularShows = await tmdb.tvShows.popular({ language: lang.tmdb as any });

        // Trending (Safe approach)
        let trendingMovies: any = { results: [] };
        let trendingShows: any = { results: [] };

        try {
          trendingMovies = await (tmdb.trending as any).movies('day', {
            language: lang.tmdb as any,
          });
        } catch {
          try {
            trendingMovies = await (tmdb.trending as any).movie('day', {
              language: lang.tmdb as any,
            });
          } catch {
            trendingMovies = popularMovies;
          }
        }

        try {
          trendingShows = await (tmdb.trending as any).tvShows('day', {
            language: lang.tmdb as any,
          });
        } catch {
          try {
            trendingShows = await (tmdb.trending as any).tv('day', { language: lang.tmdb as any });
          } catch {
            trendingShows = popularShows;
          }
        }

        // Top Rated
        const topRatedMovies = await tmdb.movies.topRated({ language: lang.tmdb as any });
        const topRatedShows = await tmdb.tvShows.topRated({ language: lang.tmdb as any });

        const catalogData = {
          updatedAt: new Date().toISOString(),
          language: lang.code,
          genres: {
            movie: movieGenres.genres,
            show: tvGenres.genres,
          },
          trending: {
            movies: (trendingMovies.results || []).map((i: any) =>
              tmdbUtils.formatMedia(i, 'movie')
            ),
            shows: (trendingShows.results || []).map((i: any) => tmdbUtils.formatMedia(i, 'show')),
          },
          popular: {
            movies: (popularMovies.results || []).map((i: any) =>
              tmdbUtils.formatMedia(i, 'movie')
            ),
            shows: (popularShows.results || []).map((i: any) => tmdbUtils.formatMedia(i, 'show')),
          },
          topRated: {
            movies: (topRatedMovies.results || []).map((i: any) =>
              tmdbUtils.formatMedia(i, 'movie')
            ),
            shows: (topRatedShows.results || []).map((i: any) => tmdbUtils.formatMedia(i, 'show')),
          },
        };

        const catalogCacheTtl =
          Number.isFinite(TMDB_CATALOG_CACHE_TTL) && TMDB_CATALOG_CACHE_TTL > 0
            ? Math.floor(TMDB_CATALOG_CACHE_TTL)
            : 30 * 24 * 60 * 60;
        await storage.setItem(`tmdb_catalog_${lang.code}`, catalogData as any, {
          ttl: catalogCacheTtl,
        });
        console.log(`[TMDB Crawler] Successfully cached catalog for ${lang.code}`);

        const movieIds = [
          ...(trendingMovies.results || []).map((i: any) => Number(i?.id)).filter(Boolean),
          ...(popularMovies.results || []).map((i: any) => Number(i?.id)).filter(Boolean),
          ...(topRatedMovies.results || []).map((i: any) => Number(i?.id)).filter(Boolean),
        ];
        const showIds = [
          ...(trendingShows.results || []).map((i: any) => Number(i?.id)).filter(Boolean),
          ...(popularShows.results || []).map((i: any) => Number(i?.id)).filter(Boolean),
          ...(topRatedShows.results || []).map((i: any) => Number(i?.id)).filter(Boolean),
        ];
        await warmMovieStreamCache(movieIds);
        await warmMoviePreviewCache(movieIds);
        await warmTvPreviewCache(showIds, lang.tmdb);
      }

      console.log('[TMDB Crawler] Crawl completed successfully for all languages.');
      return { result: 'success' };
    } catch (error) {
      console.error('[TMDB Crawler] Error during crawl:', error);
      return { result: 'error', error: String(error) };
    }
  },
});
