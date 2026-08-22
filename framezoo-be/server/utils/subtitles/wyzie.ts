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

export async function fetchWyzieSubtitles(
  context: SubtitleSearchContext,
  apiKey?: string
): Promise<StremioSubtitle[]> {
  const key = apiKey || process.env.WYZIE_API_KEY;
  if (!key) {
    return [];
  }

  const { imdbId, tmdbId, season, episode } = context;
  const targetId = imdbId || tmdbId;
  if (!targetId) return [];

  const url = new URL('https://sub.wyzie.io/search');
  url.searchParams.set('id', String(targetId));
  url.searchParams.set('key', key);
  url.searchParams.set('source', 'all');
  url.searchParams.set('encoding', 'utf-8');
  url.searchParams.set('refresh', 'true');

  if (season != null && episode != null) {
    url.searchParams.set('season', String(season));
    url.searchParams.set('episode', String(episode));
  }

  try {
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as WyzieRawSubtitle[];
    if (!Array.isArray(data)) return [];

    const subtitles: StremioSubtitle[] = [];
    const seen = new Set<string>();

    for (const sub of data) {
      if (!sub.url) continue;

      const langCode = normalizeLanguageCode(sub.language);
      const sourceName = sub.source ? String(sub.source) : 'wyzie';
      const label = sub.display || `${langCode.toUpperCase()} • Wyzie (${sourceName})`;
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

    return subtitles;
  } catch (error) {
    console.warn('[subtitles:wyzie] search failed:', error);
    return [];
  }
}
