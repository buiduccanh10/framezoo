import { fetchOmdbJson, parseOmdbRottenTomatoesScore } from './omdb';

export interface RottenTomatoesMovie {
  title: string;
  tomatoIcon: 'certified_fresh' | 'fresh' | 'rotten';
  tomatoScore: number;
  url: string;
  popcornIcon?: 'upright' | 'spilled' | 'empty';
  popcornScore?: number;
  popcornAverageRating?: number | null;
  popcornBandedRatingCount?: string | null;
  popcornReviewCount?: number | null;
  popcornUrl?: string | null;
}

export async function scrapeRottenTomatoes(
  title: string,
  year?: number
): Promise<RottenTomatoesMovie | null> {
  const cleanTitle = title.trim();
  if (!cleanTitle) return null;

  let data = await fetchOmdbJson({
    t: cleanTitle,
    y: year,
  });

  // Release dates occasionally differ by +/-1 year between TMDB and OMDb catalogs.
  if (data.Response === 'False' && year !== undefined) {
    data = await fetchOmdbJson({ t: cleanTitle });
  }

  if (data.Response === 'False') {
    return null;
  }

  const tomatoScore = parseOmdbRottenTomatoesScore(data.Ratings);
  if (tomatoScore === null) {
    return null;
  }

  const resolvedTitle = data.Title && data.Title !== 'N/A' ? data.Title : cleanTitle;
  const tomatoIcon: RottenTomatoesMovie['tomatoIcon'] =
    tomatoScore >= 75 ? 'certified_fresh' : tomatoScore >= 60 ? 'fresh' : 'rotten';

  return {
    title: resolvedTitle,
    tomatoIcon,
    tomatoScore,
    url: `https://www.rottentomatoes.com/search?search=${encodeURIComponent(resolvedTitle)}`,
  };
}
