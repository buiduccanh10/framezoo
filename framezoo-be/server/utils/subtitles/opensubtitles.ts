import { normalizeLanguageCode } from './languages';
import type { StremioSubtitle, SubtitleSearchContext } from './types';

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

function resolveOpenSubtitlesServerKey(): string | undefined {
  try {
    if (typeof useRuntimeConfig === 'function') {
      const config = useRuntimeConfig();
      const key = String(config?.opensubtitlesApiKey || '').trim();
      if (key) return key;
    }
  } catch {
    // Allow direct execution in unit tests.
  }
  const envKey = String(process.env.OPENSUBTITLES_API_KEY || '').trim();
  return envKey || undefined;
}

export async function fetchOpenSubtitles(
  context: SubtitleSearchContext,
  apiKey?: string,
  downloadBaseUrl = '/addon/subtitles/download/opensubtitles'
): Promise<StremioSubtitle[]> {
  const key = (apiKey || resolveOpenSubtitlesServerKey() || '').trim();
  if (!key) {
    return [];
  }

  const { imdbId, season, episode } = context;
  if (!imdbId || !imdbId.startsWith('tt')) {
    return [];
  }

  const numericImdbId = imdbId.slice(2).replace(/^0+/, '') || imdbId.slice(2);
  const url = new URL('https://api.opensubtitles.com/api/v1/subtitles');
  url.searchParams.set('imdb_id', numericImdbId);
  if (season != null && episode != null) {
    url.searchParams.set('type', 'episode');
    url.searchParams.set('season_number', String(season));
    url.searchParams.set('episode_number', String(episode));
  } else {
    url.searchParams.set('type', 'movie');
  }

  try {
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(12_000),
      headers: {
        'Api-Key': key,
        'User-Agent': 'Framezoo v1.0.0',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
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
      const label =
        attrs?.release || file.file_name || `${langCode.toUpperCase()} • OpenSubtitles`;
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
    return [];
  }
}
