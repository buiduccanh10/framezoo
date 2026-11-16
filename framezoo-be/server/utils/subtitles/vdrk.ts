import { normalizeLanguageCode } from './languages';
import type { StremioSubtitle, SubtitleSearchContext } from './types';
import type { SubtitleProviderFetchOptions } from './wyzie';

interface VdrkRawSubtitle {
  file?: string;
  label?: string;
}

export async function fetchVdrkSubtitles(
  context: SubtitleSearchContext,
  options?: SubtitleProviderFetchOptions
): Promise<StremioSubtitle[]> {
  const { tmdbId, season, episode } = context;
  if (!tmdbId) return [];

  const url =
    season != null && episode != null
      ? `https://sub.vdrk.site/v1/tv/${tmdbId}/${season}/${episode}`
      : `https://sub.vdrk.site/v1/movie/${tmdbId}`;

  try {
    const fetchFn = options?.fetchFn ?? fetch;
    const response = await fetchFn(url, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status !== 404) {
        console.warn(`[subtitles:vdrk] VDRK API returned HTTP ${response.status}`);
      }
      if (response.status === 429 || response.status >= 500) {
        options?.onError?.();
      }
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
    options?.onError?.();
    return [];
  }
}
