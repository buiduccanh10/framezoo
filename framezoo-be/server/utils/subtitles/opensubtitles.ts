import { normalizeLanguageCode } from './languages';
import { resolveServerSubtitleApiKey } from './serverKeys';
import type { StremioSubtitle, SubtitleSearchContext } from './types';
import type { SubtitleProviderFetchOptions } from './wyzie';

interface OpenSubtitlesV1File {
  file_id?: number;
  file_name?: string;
}

interface OpenSubtitlesV1Item {
  id?: string;
  attributes?: {
    language?: string;
    release?: string;
    hearing_impaired?: boolean;
    format?: string;
    files?: OpenSubtitlesV1File[];
  };
}

interface OpenSubtitlesV1Response {
  data?: OpenSubtitlesV1Item[];
}

export async function fetchOpenSubtitles(
  context: SubtitleSearchContext,
  apiKey?: string,
  downloadBaseUrl = '/addon/subtitles/download/opensubtitles',
  options?: SubtitleProviderFetchOptions
): Promise<StremioSubtitle[]> {
  const key = apiKey?.trim() || resolveServerSubtitleApiKey('opensubtitles');
  if (!key) {
    return [];
  }

  const { imdbId, tmdbId, season, episode } = context;
  const hasImdb = Boolean(imdbId && imdbId.startsWith('tt'));
  if (!hasImdb && !tmdbId) {
    return [];
  }

  const url = new URL('https://api.opensubtitles.com/api/v1/subtitles');
  if (hasImdb && imdbId) {
    const numericImdbId = imdbId.slice(2).replace(/^0+/, '') || imdbId.slice(2);
    url.searchParams.set('imdb_id', numericImdbId);
  } else if (tmdbId) {
    url.searchParams.set('tmdb_id', String(tmdbId));
  }
  if (season != null && episode != null) {
    url.searchParams.set('type', 'episode');
    url.searchParams.set('season_number', String(season));
    url.searchParams.set('episode_number', String(episode));
  } else {
    url.searchParams.set('type', 'movie');
  }

  try {
    const fetchFn = options?.fetchFn ?? fetch;
    const response = await fetchFn(url.toString(), {
      signal: AbortSignal.timeout(12_000),
      headers: {
        'Api-Key': key,
        'User-Agent': 'Framezoo v1.0.0',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`[subtitles:opensubtitles] OpenSubtitles API returned HTTP ${response.status}`);
      if (response.status === 429 || response.status >= 500) {
        options?.onError?.();
      }
      return [];
    }

    const payload = (await response.json()) as OpenSubtitlesV1Response;
    const data = Array.isArray(payload?.data) ? payload.data : [];

    const subtitles: StremioSubtitle[] = [];
    const seenFileIds = new Set<number>();

    for (const item of data) {
      const attrs = item.attributes;
      const file = attrs?.files?.[0];
      if (!file?.file_id || seenFileIds.has(file.file_id)) continue;

      const langCode = normalizeLanguageCode(attrs?.language);
      if (!langCode || langCode === 'unknown') continue;

      seenFileIds.add(file.file_id);
      const downloadUrl = `${downloadBaseUrl}/${file.file_id}`;
      const label = attrs?.release || file.file_name || `${langCode.toUpperCase()} • OpenSubtitles`;
      const id = `opensubs:${file.file_id}:${langCode}`;

      subtitles.push({
        id,
        url: downloadUrl,
        lang: langCode,
        label,
        source: 'opensubs',
        type: attrs?.format || 'srt',
        isHearingImpaired: Boolean(attrs?.hearing_impaired),
      });
    }

    return subtitles;
  } catch (error) {
    console.warn('[subtitles:opensubtitles] v1 search failed:', error);
    options?.onError?.();
    return [];
  }
}
