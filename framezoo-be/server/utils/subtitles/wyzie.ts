import { normalizeLanguageCode } from './languages';
import type { StremioSubtitle, SubtitleSearchContext } from './types';

interface WyzieRawSubtitle {
  id?: string | number;
  url?: string;
  language?: string;
  source?: string;
  format?: string;
  display?: string;
  media?: string;
  isHearingImpaired?: boolean;
  encoding?: string;
}

// Wyzie API accepts 1-2 languages per query. Batching them into 2-language chunks
// triggers all dedicated upstream scrapers without exceeding Wyzie query limits.
const LANGUAGE_CHUNKS = [
  'vi',
  'en',
  'es,fr',
  'de,it',
  'pt,ru',
  'zh,ja',
  'ko,th',
  'id,ms',
  'ar,tr',
  'nl,pl',
  'ro,cs',
  'sv,da',
  'no,fi',
  'el,he',
  'hu,uk',
  'fa,hi',
  'sk,sl',
  'sr,hr',
  'bg,et',
];

export async function fetchWyzieSubtitles(
  context: SubtitleSearchContext,
  apiKey?: string,
  preferredLanguages: string[] = []
): Promise<StremioSubtitle[]> {
  const key = (apiKey || process.env.WYZIE_API_KEY || '').trim();
  if (!key) {
    console.warn('[subtitles:wyzie] WYZIE_API_KEY is not configured on server');
    return [];
  }

  const { imdbId, tmdbId, title, season, episode } = context;
  if (!imdbId && !tmdbId && !title) return [];

  const searchUrls: string[] = [];

  const buildUrl = (idValue: string | number, language?: string) => {
    const url = new URL('https://sub.wyzie.io/search');
    url.searchParams.set('id', String(idValue));
    url.searchParams.set('key', key);
    url.searchParams.set('source', 'all');

    if (language) {
      url.searchParams.set('language', language);
    }

    if (season != null && episode != null) {
      url.searchParams.set('season', String(season));
      url.searchParams.set('episode', String(episode));
    }
    return url.toString();
  };

  const candidateIds = Array.from(
    new Set([imdbId, tmdbId ? String(tmdbId) : undefined].filter((v): v is string => Boolean(v)))
  );

  for (const idVal of candidateIds) {
    // 1. General search without language param
    searchUrls.push(buildUrl(idVal));

    // 2. User's specific preferred languages (e.g. from Accept-Language or client request)
    for (const lang of preferredLanguages) {
      if (lang) {
        searchUrls.push(buildUrl(idVal, lang));
      }
    }

    // 3. Chunked multi-language queries covering all world regions
    for (const chunk of LANGUAGE_CHUNKS) {
      searchUrls.push(buildUrl(idVal, chunk));
    }
  }

  const uniqueUrls = Array.from(new Set(searchUrls));

  try {
    const responses = await Promise.allSettled(
      uniqueUrls.map(async url => {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(8_000),
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; Framezoo/1.0)',
          },
        });

        if (!response.ok) {
          return [];
        }

        const json = await response.json();
        let items: WyzieRawSubtitle[] = [];
        if (Array.isArray(json)) {
          items = json;
        } else if (json && typeof json === 'object') {
          if (Array.isArray((json as Record<string, unknown>).subtitles)) {
            items = (json as Record<string, unknown>).subtitles as WyzieRawSubtitle[];
          } else if (Array.isArray((json as Record<string, unknown>).data)) {
            items = (json as Record<string, unknown>).data as WyzieRawSubtitle[];
          } else if (Array.isArray((json as Record<string, unknown>).results)) {
            items = (json as Record<string, unknown>).results as WyzieRawSubtitle[];
          }
        }

        return items;
      })
    );

    const subtitles: StremioSubtitle[] = [];
    const seen = new Set<string>();

    for (const res of responses) {
      if (res.status !== 'fulfilled') continue;

      for (const sub of res.value) {
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
          isHearingImpaired: Boolean(sub.isHearingImpaired),
          encoding: sub.encoding,
        });
      }
    }

    return subtitles;
  } catch (error) {
    console.warn('[subtitles:wyzie] search failed:', error);
    return [];
  }
}
