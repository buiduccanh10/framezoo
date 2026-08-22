import { normalizeLanguageCode } from './languages';
import type { StremioSubtitle, SubtitleSearchContext } from './types';

interface VdrkRawSubtitle {
  file?: string;
  label?: string;
}

export async function fetchVdrkSubtitles(
  context: SubtitleSearchContext
): Promise<StremioSubtitle[]> {
  const { tmdbId, season, episode } = context;
  if (!tmdbId) return [];

  const url =
    season != null && episode != null
      ? `https://sub.vdrk.site/v1/tv/${tmdbId}/${season}/${episode}`
      : `https://sub.vdrk.site/v1/movie/${tmdbId}`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as VdrkRawSubtitle[];
    if (!Array.isArray(data)) return [];

    const subtitles: StremioSubtitle[] = [];
    const seen = new Set<string>();

    for (const sub of data) {
      if (!sub.file || !sub.label) continue;

      const label = sub.label;
      const isHearingImpaired = label.includes(' Hi') || label.includes('Hi');
      const languageName = label
        .replace(/\s*Hi\d*$/, '')
        .replace(/\s*Hi$/, '')
        .replace(/\d+$/, '');

      const langCode = normalizeLanguageCode(languageName);
      if (!langCode || langCode === 'unknown') continue;

      if (seen.has(sub.file)) continue;
      seen.add(sub.file);

      const id = `granite:${langCode}:${sub.file}`;

      subtitles.push({
        id,
        url: sub.file,
        lang: langCode,
        label: sub.label,
        source: 'granite',
        type: 'vtt',
        isHearingImpaired,
      });
    }

    return subtitles;
  } catch (error) {
    console.warn('[subtitles:vdrk] search failed:', error);
    return [];
  }
}
