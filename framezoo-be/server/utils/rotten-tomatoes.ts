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

interface SearchResultMovie {
  name: string;
  url: string;
  year: number | null;
  tomatometer: {
    value: number;
    state: RottenTomatoesMovie['tomatoIcon'];
  };
}

interface MediaScorecardScore {
  averageRating?: string;
  bandedRatingCount?: string;
  reviewCount?: number;
  score?: string;
  sentiment?: string;
  certified?: boolean;
  reviewsPageUrl?: string;
}

interface MediaScorecardPayload {
  audienceScore?: MediaScorecardScore;
  criticsScore?: MediaScorecardScore;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function calculateSimilarity(str1: string, str2: string): number {
  const s1 = normalizeTitle(str1);
  const s2 = normalizeTitle(str2);

  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) {
    return 0.9;
  }

  const words1 = new Set(s1.split(/\s+/).filter(Boolean));
  const words2 = new Set(s2.split(/\s+/).filter(Boolean));
  const intersection = new Set([...words1].filter(word => words2.has(word)));
  const union = new Set([...words1, ...words2]);

  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

function findBestMatch(searchTitle: string, movies: SearchResultMovie[], year?: number) {
  let bestMatch: SearchResultMovie | null = null;
  let bestScore = 0;

  for (const movie of movies) {
    const similarity = calculateSimilarity(searchTitle, movie.name);
    const yearBoost = year && movie.year === year ? 0.2 : 0;
    const score = similarity + yearBoost;

    if (score > bestScore && (score >= 0.5 || (yearBoost && score >= 0.3))) {
      bestMatch = movie;
      bestScore = score;
    }
  }

  return bestMatch;
}

function toAbsoluteRtUrl(url: string): string | null {
  if (!url) return null;

  try {
    return new URL(url, 'https://www.rottentomatoes.com').toString();
  } catch {
    return null;
  }
}

function parseEmbeddedJson<T>(html: string, scriptId: string): T | null {
  const match = html.match(
    new RegExp(
      `<script[^>]+id=["']${scriptId}["'][^>]*>\\s*([\\s\\S]*?)\\s*<\\/script>`,
      'i',
    ),
  );
  if (!match?.[1]) return null;

  try {
    return JSON.parse(match[1]) as T;
  } catch {
    return null;
  }
}

function parseScore(value?: string): number | null {
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAverageRating(value?: string): number | null {
  if (!value) return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTomatoIcon(
  score: number | null,
  sentiment?: string,
  certified?: boolean,
): RottenTomatoesMovie['tomatoIcon'] {
  if (certified && (score ?? 0) >= 75) {
    return 'certified_fresh';
  }

  return sentiment?.toUpperCase() === 'POSITIVE' ? 'fresh' : 'rotten';
}

function toPopcornIcon(
  score: number | null,
  sentiment?: string,
): NonNullable<RottenTomatoesMovie['popcornIcon']> {
  if (score === null) return 'empty';
  return sentiment?.toUpperCase() === 'POSITIVE' ? 'upright' : 'spilled';
}

function matchAttribute(row: string, attributes: string[]): string | null {
  for (const attribute of attributes) {
    const match = row.match(new RegExp(`${attribute}="([^"]*)"`, 'i'));
    if (match?.[1] !== undefined && match[1].trim().length > 0) {
      return match[1];
    }
  }

  return null;
}

function parseMovieRows(html: string): SearchResultMovie[] {
  const movieRows = html.match(/<search-page-media-row\b[^>]*>[\s\S]*?<\/search-page-media-row>/g);
  if (!movieRows?.length) return [];

  return movieRows
    .map(row => {
      const nameMatch = row.match(/data-qa="info-name"[^>]*>([^<]+)</);
      const urlMatch = row.match(/href="([^"]+)"/);
      const scoreValue = matchAttribute(row, ['tomatometer-score', 'tomatometerscore']);
      const sentimentValue = matchAttribute(row, ['tomatometer-sentiment', 'tomatometersentiment']);
      const yearValue = matchAttribute(row, ['release-year', 'releaseyear', 'start-year', 'startyear']);
      const certifiedValue = matchAttribute(row, ['tomatometer-is-certified', 'tomatometeriscertified']);

      const absoluteUrl = toAbsoluteRtUrl(urlMatch?.[1]?.trim() ?? '');
      if (!absoluteUrl || (!absoluteUrl.includes('/m/') && !absoluteUrl.includes('/tv/'))) {
        return null;
      }

      const tomatoScore = parseInt(scoreValue || '0', 10) || 0;
      const sentiment = (sentimentValue || '').toLowerCase();
      const isCertified = certifiedValue === 'true' && tomatoScore >= 75;

      return {
        name: nameMatch?.[1]?.trim() ?? '',
        url: absoluteUrl,
        year: yearValue ? parseInt(yearValue, 10) : null,
        tomatometer: {
          value: tomatoScore,
          state: isCertified ? 'certified_fresh' : sentiment === 'positive' ? 'fresh' : 'rotten',
        },
      } satisfies SearchResultMovie;
    })
    .filter((movie): movie is SearchResultMovie => Boolean(movie?.name));
}

export async function scrapeRottenTomatoes(title: string, year?: number): Promise<RottenTomatoesMovie | null> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return null;

  const searchQuery = encodeURIComponent(trimmedTitle);
  const searchUrl = `https://www.rottentomatoes.com/search?search=${searchQuery}`;

  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Rotten Tomatoes search failed with status ${response.status}`);
  }

  const html = await response.text();
  const movies = parseMovieRows(html);
  const match = findBestMatch(trimmedTitle, movies, year);

  if (!match) return null;

  let tomatoScore = match.tomatometer.value;
  let tomatoIcon = match.tomatometer.state;
  let popcornIcon: RottenTomatoesMovie['popcornIcon'];
  let popcornScore: number | undefined;
  let popcornAverageRating: number | null = null;
  let popcornBandedRatingCount: string | null = null;
  let popcornReviewCount: number | null = null;
  let popcornUrl: string | null = null;

  try {
    const detailResponse = await fetch(match.url, {
      headers: {
        'User-Agent': USER_AGENT,
      },
    });

    if (detailResponse.ok) {
      const detailHtml = await detailResponse.text();
      const scorecard = parseEmbeddedJson<MediaScorecardPayload>(
        detailHtml,
        'media-scorecard-json',
      );

      const criticsScore = scorecard?.criticsScore;
      const audienceScore = scorecard?.audienceScore;

      const parsedTomatoScore = parseScore(criticsScore?.score);
      if (parsedTomatoScore !== null) {
        tomatoScore = parsedTomatoScore;
        tomatoIcon = toTomatoIcon(
          parsedTomatoScore,
          criticsScore?.sentiment,
          criticsScore?.certified,
        );
      }

      const parsedPopcornScore = parseScore(audienceScore?.score);
      if (parsedPopcornScore !== null) {
        popcornScore = parsedPopcornScore;
      }

      popcornIcon = toPopcornIcon(parsedPopcornScore, audienceScore?.sentiment);
      popcornAverageRating = parseAverageRating(audienceScore?.averageRating);
      popcornBandedRatingCount = audienceScore?.bandedRatingCount ?? null;
      popcornReviewCount =
        typeof audienceScore?.reviewCount === 'number'
          ? audienceScore.reviewCount
          : null;
      popcornUrl = toAbsoluteRtUrl(audienceScore?.reviewsPageUrl ?? '');
    }
  } catch {
    // Keep Tomatometer-only fallback when detail scraping fails.
  }

  return {
    title: match.name,
    tomatoIcon,
    tomatoScore,
    url: match.url,
    ...(popcornIcon ? { popcornIcon } : {}),
    ...(popcornScore !== undefined ? { popcornScore } : {}),
    ...(popcornAverageRating !== null ? { popcornAverageRating } : {}),
    ...(popcornBandedRatingCount ? { popcornBandedRatingCount } : {}),
    ...(popcornReviewCount !== null ? { popcornReviewCount } : {}),
    ...(popcornUrl ? { popcornUrl } : {}),
  };
}
