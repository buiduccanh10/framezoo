import { normalizeLanguageCode } from './languages';
import type { StremioSubtitle, SubtitleSearchContext } from './types';

interface OpenSubtitlesRawItem {
  SubDownloadLink?: string;
  LanguageName?: string;
  SubFormat?: string;
  SubFileName?: string;
}

export async function fetchOpenSubtitles(
  context: SubtitleSearchContext
): Promise<StremioSubtitle[]> {
  const { imdbId, season, episode } = context;
  if (!imdbId || !imdbId.startsWith('tt')) {
    return [];
  }

  const cleanImdb = imdbId.slice(2);
  const path =
    season != null && episode != null
      ? `episode-${episode}/imdbid-${cleanImdb}/season-${season}`
      : `imdbid-${cleanImdb}`;

  const url = `https://rest.opensubtitles.org/search/${path}`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: {
        'X-User-Agent': 'VLSub 0.10.2',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as OpenSubtitlesRawItem[];
    if (!Array.isArray(data)) return [];

    const subtitles: StremioSubtitle[] = [];
    const seen = new Set<string>();

    for (const item of data) {
      if (!item.SubDownloadLink) continue;

      const downloadUrl = item.SubDownloadLink.replace('.gz', '').replace(
        'download/',
        'download/subencoding-utf8/'
      );

      const langCode = normalizeLanguageCode(item.LanguageName);
      if (!downloadUrl || !langCode) continue;

      if (seen.has(downloadUrl)) continue;
      seen.add(downloadUrl);

      const label = item.SubFileName || item.LanguageName || `${langCode.toUpperCase()} • OpenSubtitles`;
      const id = `opensubs:${langCode}:${downloadUrl}`;

      subtitles.push({
        id,
        url: downloadUrl,
        lang: langCode,
        label,
        source: 'opensubs',
        type: item.SubFormat || 'srt',
      });
    }

    return subtitles;
  } catch (error) {
    console.warn('[subtitles:opensubtitles] search failed:', error);
    return [];
  }
}
