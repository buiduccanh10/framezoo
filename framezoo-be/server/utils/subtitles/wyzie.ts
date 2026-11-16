import { normalizeLanguageCode } from './languages';
import { resolveServerSubtitleApiKey } from './serverKeys';
import type { StremioSubtitle, SubtitleSearchContext } from './types';

interface WyzieRawSubtitle {
  id?: string | number;
  url?: string;
  language?: string;
  source?: string;
  format?: string;
  display?: string;
  media?: string;
  fileName?: string;
  release?: string;
  isHearingImpaired?: boolean;
  hearing_impaired?: boolean | string | number;
  hearingImpaired?: boolean | string | number;
  hi?: boolean | string | number;
  encoding?: string;
}

export interface SubtitleProviderFetchOptions {
  onError?: () => void;
  fetchFn?: typeof fetch;
}

function extractWyzieItems(json: unknown): WyzieRawSubtitle[] {
  if (Array.isArray(json)) return json as WyzieRawSubtitle[];
  if (!json || typeof json !== 'object') return [];

  const record = json as Record<string, unknown>;
  for (const field of ['subtitles', 'data', 'results']) {
    if (Array.isArray(record[field])) {
      return record[field] as WyzieRawSubtitle[];
    }
  }
  return [];
}

export async function fetchWyzieSubtitles(
  context: SubtitleSearchContext,
  apiKey?: string,
  _preferredLanguages: string[] = [],
  options?: SubtitleProviderFetchOptions
): Promise<StremioSubtitle[]> {
  const key = apiKey?.trim() || resolveServerSubtitleApiKey('wyzie');
  if (!key) {
    console.warn('[subtitles:wyzie] WYZIE_API_KEY is not configured on server');
    return [];
  }

  const { imdbId, tmdbId, season, episode } = context;
  const candidateIds = Array.from(
    new Set([imdbId, tmdbId ? String(tmdbId) : undefined].filter((v): v is string => Boolean(v)))
  );
  if (candidateIds.length === 0) return [];

  const fetchFn = options?.fetchFn ?? fetch;
  const buildUrl = (idValue: string) => {
    const url = new URL('https://sub.wyzie.io/search');
    url.searchParams.set('id', idValue);
    url.searchParams.set('key', key);
    url.searchParams.set('source', 'all');

    if (season != null && episode != null) {
      url.searchParams.set('season', String(season));
      url.searchParams.set('episode', String(episode));
    }
    return url.toString();
  };

  try {
    // Query once without a language filter (source=all returns all languages) and only fall back
    // to TMDB ID if IMDb returned empty, avoiding 32x daily quota exhaustion.
    let items: WyzieRawSubtitle[] = [];
    for (const idVal of candidateIds) {
      const response = await fetchFn(buildUrl(idVal), {
        signal: AbortSignal.timeout(8_000),
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; Framezoo/1.0)',
        },
      });

      if (!response.ok) {
        console.warn(`[subtitles:wyzie] Wyzie API returned HTTP ${response.status}`);
        if (response.status === 429 || response.status >= 500) {
          options?.onError?.();
        }
        return [];
      }

      items = extractWyzieItems(await response.json());
      if (items.length > 0) break;
    }

    const subtitles: StremioSubtitle[] = [];
    const seen = new Set<string>();

    for (const sub of items) {
      if (!sub.url) continue;

      const langCode = normalizeLanguageCode(sub.language);
      const sourceName = sub.source ? String(sub.source) : 'wyzie';
      const label =
        sub.fileName ||
        sub.release ||
        sub.media ||
        sub.display ||
        `${langCode.toUpperCase()} • Wyzie (${sourceName})`;
      const id = `wyzie:${sourceName}:${sub.id ?? ''}:${langCode}:${sub.url}`;

      if (seen.has(sub.url)) continue;
      seen.add(sub.url);

      subtitles.push({
        id,
        url: sub.url,
        lang: langCode,
        label,
        source: `wyzie ${sourceName === 'opensubtitles' ? 'opensubs' : sourceName}`,
        type: sub.format || 'srt',
        isHearingImpaired: Boolean(
          sub.isHearingImpaired ||
          sub.hearing_impaired ||
          sub.hearingImpaired ||
          sub.hi ||
          (label &&
            /(?:^|[._\s\-[\]()])(hi|sdh)(?:$|[._\s\-[\]()])|\bhearing[._\s-]?impaired\b/i.test(
              label
            ))
        ),
        encoding: sub.encoding,
      });
    }

    return subtitles;
  } catch (error) {
    console.warn('[subtitles:wyzie] search failed:', error);
    options?.onError?.();
    return [];
  }
}
