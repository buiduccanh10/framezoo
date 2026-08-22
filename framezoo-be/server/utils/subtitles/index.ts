import { tmdb } from '~/utils/tmdb';

import { normalizeLanguageCode } from './languages';
import { fetchOpenSubtitles } from './opensubtitles';
import { fetchSubsourceSubtitlesList } from './subsource';
import type { StremioSubtitle, SubtitleSearchContext } from './types';
import { fetchVdrkSubtitles } from './vdrk';
import { fetchWyzieSubtitles } from './wyzie';

export * from './types';
export * from './languages';

const SOURCE_PRIORITY: Record<string, number> = {
  wyzie: 0,
  opensubs: 1,
  subsource: 2,
  granite: 3,
};

function getSourcePriority(source?: string): number {
  if (!source) return 99;
  const lower = source.toLowerCase();
  if (lower.includes('wyzie')) return SOURCE_PRIORITY.wyzie;
  if (lower.includes('opensubs')) return SOURCE_PRIORITY.opensubs;
  if (lower.includes('subsource')) return SOURCE_PRIORITY.subsource;
  if (lower.includes('granite')) return SOURCE_PRIORITY.granite;
  return 99;
}

export async function resolveSubtitleContext(
  type: 'movie' | 'series',
  idParam: string
): Promise<SubtitleSearchContext> {
  const cleanId = decodeURIComponent(idParam).replace(/\.json$/, '').trim();
  const parts = cleanId.split(':');
  const baseId = parts[0];

  let season: number | undefined;
  let episode: number | undefined;
  if (parts.length >= 3) {
    const s = parseInt(parts[1], 10);
    const e = parseInt(parts[2], 10);
    if (!Number.isNaN(s) && !Number.isNaN(e)) {
      season = s;
      episode = e;
    }
  }

  let imdbId: string | undefined;
  let tmdbId: number | undefined;
  let title: string | undefined;
  let releaseYear: number | undefined;

  if (baseId.startsWith('tt')) {
    imdbId = baseId;
  } else if (baseId.startsWith('tmdb:')) {
    const parsed = parseInt(baseId.replace('tmdb:', ''), 10);
    if (!Number.isNaN(parsed)) tmdbId = parsed;
  } else if (/^\d+$/.test(baseId)) {
    const parsed = parseInt(baseId, 10);
    if (!Number.isNaN(parsed)) tmdbId = parsed;
  }

  // Resolve missing IDs via TMDB if possible
  try {
    if (imdbId && !tmdbId) {
      const findRes = (await tmdb.fetch(`/find/${imdbId}`, {
        external_source: 'imdb_id',
      })) as any;

      if (type === 'movie' && findRes?.movie_results?.length > 0) {
        const movie = findRes.movie_results[0];
        tmdbId = movie.id;
        title = movie.title;
        if (movie.release_date) {
          releaseYear = new Date(movie.release_date).getFullYear();
        }
      } else if (type === 'series' && findRes?.tv_results?.length > 0) {
        const tv = findRes.tv_results[0];
        tmdbId = tv.id;
        title = tv.name;
        if (tv.first_air_date) {
          releaseYear = new Date(tv.first_air_date).getFullYear();
        }
      }
    } else if (tmdbId && !imdbId) {
      if (type === 'movie') {
        const movie = (await tmdb.movies.details(tmdbId, {
          append_to_response: 'external_ids',
        })) as any;
        if (movie) {
          imdbId = movie.external_ids?.imdb_id || movie.imdb_id;
          title = movie.title;
          if (movie.release_date) {
            releaseYear = new Date(movie.release_date).getFullYear();
          }
        }
      } else if (type === 'series') {
        const tv = (await tmdb.tvShows.details(tmdbId, {
          append_to_response: 'external_ids',
        })) as any;
        if (tv) {
          imdbId = tv.external_ids?.imdb_id;
          title = tv.name;
          if (tv.first_air_date) {
            releaseYear = new Date(tv.first_air_date).getFullYear();
          }
        }
      }
    }
  } catch (err) {
    console.debug('[subtitles:tmdb-lookup] lookup skipped or failed:', err);
  }

  return {
    type,
    id: cleanId,
    imdbId,
    tmdbId,
    season,
    episode,
    title,
    releaseYear,
  };
}

export async function searchAllSubtitles(
  context: SubtitleSearchContext,
  options?: {
    wyzieApiKey?: string;
    subsourceApiKey?: string;
    subsourceDownloadBaseUrl?: string;
    preferredLanguages?: string[];
  }
): Promise<StremioSubtitle[]> {
  const downloadBaseUrl = options?.subsourceDownloadBaseUrl || '/addon/subtitles/download/subsource';

  const results = await Promise.allSettled([
    fetchWyzieSubtitles(context, options?.wyzieApiKey, options?.preferredLanguages),
    fetchOpenSubtitles(context),
    fetchSubsourceSubtitlesList(context, options?.subsourceApiKey, downloadBaseUrl),
    fetchVdrkSubtitles(context),
  ]);

  const allSubtitles: StremioSubtitle[] = [];
  const seenUrls = new Set<string>();

  for (const res of results) {
    if (res.status === 'fulfilled') {
      for (const sub of res.value) {
        if (!sub.url) continue;
        if (seenUrls.has(sub.url)) continue;
        seenUrls.add(sub.url);
        allSubtitles.push(sub);
      }
    }
  }

  // Sort by provider priority, then language, then label
  allSubtitles.sort((a, b) => {
    const priorityDiff = getSourcePriority(a.source) - getSourcePriority(b.source);
    if (priorityDiff !== 0) return priorityDiff;

    const langDiff = a.lang.localeCompare(b.lang);
    if (langDiff !== 0) return langDiff;

    return (a.label || '').localeCompare(b.label || '');
  });

  return allSubtitles;
}
