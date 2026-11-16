export interface OmdbRatingEntry {
  Source?: string;
  Value?: string;
}

export interface OmdbTitleResponse {
  Response?: string;
  Error?: string;
  Title?: string;
  Year?: string;
  Rated?: string;
  Released?: string;
  Runtime?: string;
  Genre?: string;
  Director?: string;
  Writer?: string;
  Actors?: string;
  Plot?: string;
  Language?: string;
  Country?: string;
  Poster?: string;
  Ratings?: OmdbRatingEntry[];
  imdbRating?: string;
  imdbVotes?: string;
  imdbID?: string;
  Type?: string;
  totalSeasons?: string;
}

export function resolveOmdbApiKey(): string {
  try {
    if (typeof useRuntimeConfig === 'function') {
      const config = useRuntimeConfig();
      const key = String(config?.omdbApiKey || '').trim();
      if (key) return key;
    }
  } catch {
    // Allow direct execution in node:test without Nitro runtime context.
  }

  const envKey = String(process.env.OMDB_API_KEY || '').trim();
  if (!envKey) {
    throw createOmdbConfigError();
  }
  return envKey;
}

function createOmdbConfigError(): Error & { statusCode?: number } {
  const err = new Error('OMDB_API_KEY is not configured on server') as Error & {
    statusCode?: number;
  };
  err.statusCode = 503;
  return err;
}

export function parseOmdbNumber(raw?: string): number | null {
  if (!raw || raw === 'N/A') return null;
  const cleaned = raw.replace(/,/g, '').trim();
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseOmdbInteger(raw?: string): number | null {
  if (!raw || raw === 'N/A') return null;
  const match = raw.replace(/,/g, '').match(/\d+/);
  if (!match) return null;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseOmdbList(raw?: string): string[] | undefined {
  if (!raw || raw === 'N/A') return undefined;
  const items = raw
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0 && item !== 'N/A');
  return items.length > 0 ? items : undefined;
}

export function parseOmdbRottenTomatoesScore(ratings?: OmdbRatingEntry[]): number | null {
  if (!Array.isArray(ratings)) return null;
  const entry = ratings.find(r => r?.Source === 'Rotten Tomatoes' && typeof r.Value === 'string');
  if (!entry?.Value) return null;
  const match = entry.Value.match(/(\d{1,3})\s*%/);
  if (!match) return null;
  const score = Number.parseInt(match[1], 10);
  return Number.isFinite(score) && score >= 0 && score <= 100 ? score : null;
}

export async function fetchOmdbJson(
  params: Record<string, string | number | undefined>
): Promise<OmdbTitleResponse> {
  const apiKey = resolveOmdbApiKey();
  const url = new URL('https://www.omdbapi.com/');
  url.searchParams.set('apikey', apiKey);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && String(value).trim() !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`OMDb request failed with status ${response.status}`);
  }

  return (await response.json()) as OmdbTitleResponse;
}
