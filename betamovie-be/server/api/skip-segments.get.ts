import { z } from 'zod';

const INTRODB_SEGMENTS_URL = 'https://api.introdb.app/segments';
const THE_INTRODB_MEDIA_URL = 'https://api.theintrodb.org/v2/media';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const IMDB_CACHE_TTL_SECONDS = 24 * 60 * 60;

type SegmentType = 'intro' | 'recap' | 'credits' | 'preview';

interface SegmentData {
  type: SegmentType;
  start_ms: number | null;
  end_ms: number | null;
  confidence: number | null;
  submission_count: number;
}

const querySchema = z
  .object({
    type: z.enum(['movie', 'show']),
    tmdbId: z.string().min(1),
    season: z.coerce.number().int().positive().optional(),
    episode: z.coerce.number().int().positive().optional(),
    imdbId: z
      .string()
      .trim()
      .regex(/^tt\d{7,8}$/i)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'show') {
      if (!value.season) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['season'],
          message: 'season is required for show',
        });
      }
      if (!value.episode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['episode'],
          message: 'episode is required for show',
        });
      }
    }
  });

const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const normalizeSegment = (type: SegmentType, raw: unknown): SegmentData | null => {
  if (!raw || typeof raw !== 'object') return null;
  const segment = raw as Record<string, unknown>;

  const startMs = toNullableNumber(segment.start_ms);
  const endMs = toNullableNumber(segment.end_ms);
  if (startMs === null && endMs === null) return null;

  const confidence = toNullableNumber(segment.confidence);
  const submissionCount = toNullableNumber(segment.submission_count);

  return {
    type,
    start_ms: startMs,
    end_ms: endMs,
    confidence,
    submission_count: submissionCount !== null && submissionCount > 0 ? submissionCount : 1,
  };
};

const pushNormalizedSegments = (
  target: SegmentData[],
  type: SegmentType,
  source: unknown
) => {
  if (Array.isArray(source)) {
    for (const item of source) {
      const normalized = normalizeSegment(type, item);
      if (normalized) target.push(normalized);
    }
    return;
  }

  const normalized = normalizeSegment(type, source);
  if (normalized) target.push(normalized);
};

const normalizeIntroDbSegments = (data: unknown): SegmentData[] => {
  const payload = data as Record<string, unknown> | null | undefined;
  if (!payload || typeof payload !== 'object') return [];

  const segments: SegmentData[] = [];
  pushNormalizedSegments(segments, 'intro', payload.intro);
  pushNormalizedSegments(segments, 'recap', payload.recap);
  // introdb calls this "outro"; player uses "credits".
  pushNormalizedSegments(segments, 'credits', payload.outro);
  return segments;
};

const normalizeTheIntroDbSegments = (data: unknown): SegmentData[] => {
  const payload = data as Record<string, unknown> | null | undefined;
  if (!payload || typeof payload !== 'object') return [];

  const segments: SegmentData[] = [];
  pushNormalizedSegments(segments, 'intro', payload.intro);
  pushNormalizedSegments(segments, 'recap', payload.recap);
  pushNormalizedSegments(segments, 'credits', payload.credits);
  pushNormalizedSegments(segments, 'preview', payload.preview);
  return segments;
};

const resolveTmdbKey = (event: Parameters<typeof useRuntimeConfig>[0]) => {
  const config = useRuntimeConfig(event);
  return ((config.tmdbApiKey as string | undefined) || process.env.TMDB_API_KEY || '').trim();
};

const resolveImdbIdFromTmdb = async (
  event: Parameters<typeof useRuntimeConfig>[0],
  tmdbId: string,
  mediaType: 'movie' | 'show'
): Promise<string | null> => {
  const storage = useStorage('cache');
  const cacheKey = `skip-segments:imdb:${mediaType}:${tmdbId}`;

  try {
    const cached = await storage.getItem<string>(cacheKey);
    if (cached) return cached;
  } catch {
    // ignore cache read failures
  }

  const tmdbKey = resolveTmdbKey(event);
  if (!tmdbKey) return null;

  const tmdbPath = mediaType === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const url = `${TMDB_BASE_URL}${tmdbPath}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': TMDB_UA,
  };
  const query: Record<string, string> = {
    append_to_response: 'external_ids',
    language: 'en-US',
  };

  if (tmdbKey.length > 50) {
    headers.Authorization = `Bearer ${tmdbKey}`;
  } else {
    query.api_key = tmdbKey;
  }

  const data = await $fetch<Record<string, unknown>>(url, {
    query,
    headers,
    retry: 2,
    retryDelay: 700,
    timeout: 10000,
  });

  const directImdbId =
    typeof data.imdb_id === 'string'
      ? data.imdb_id
      : typeof (data.external_ids as any)?.imdb_id === 'string'
        ? (data.external_ids as any).imdb_id
        : null;

  if (!directImdbId) return null;

  try {
    await storage.setItem(cacheKey, directImdbId, { ttl: IMDB_CACHE_TTL_SECONDS });
  } catch {
    // ignore cache write failures
  }

  return directImdbId;
};

export default defineEventHandler(async event => {
  const parsed = querySchema.safeParse(getQuery(event));
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message || 'Invalid query',
    });
  }

  const params = parsed.data;
  const tidbKey =
    ((useRuntimeConfig(event).tidbApiKey as string | undefined) || process.env.TIDB_API_KEY || '').trim() ||
    null;

  const fetchTheIntroDbSegments = async (): Promise<SegmentData[]> => {
    const query: Record<string, string | number> = {
      tmdb_id: params.tmdbId,
    };
    if (params.type === 'show' && params.season && params.episode) {
      query.season = params.season;
      query.episode = params.episode;
    }

    const data = await $fetch<Record<string, unknown>>(THE_INTRODB_MEDIA_URL, {
      query,
      headers: tidbKey ? { Authorization: `Bearer ${tidbKey}` } : undefined,
      retry: 0,
      timeout: 10000,
    });

    return normalizeTheIntroDbSegments(data);
  };

  // IntroDB only supports episodic content, so movies use TheIntroDB directly.
  if (params.type === 'movie') {
    try {
      const segments = await fetchTheIntroDbSegments();
      return { source: 'theintrodb' as const, segments };
    } catch (error: any) {
      throw createError({
        statusCode: error?.statusCode || error?.response?.status || 502,
        statusMessage: 'Failed to fetch movie skip segments',
      });
    }
  }

  const imdbId =
    params.imdbId ||
    (await resolveImdbIdFromTmdb(event, params.tmdbId, 'show').catch(() => null));

  if (!imdbId) {
    try {
      const segments = await fetchTheIntroDbSegments();
      return { source: 'theintrodb' as const, segments };
    } catch {
      return { source: null, segments: [] as SegmentData[] };
    }
  }

  try {
    const introDbPayload = await $fetch<Record<string, unknown>>(INTRODB_SEGMENTS_URL, {
      query: {
        imdb_id: imdbId,
        season: params.season,
        episode: params.episode,
      },
      retry: 0,
      timeout: 8000,
    });

    return {
      source: 'introdb' as const,
      segments: normalizeIntroDbSegments(introDbPayload),
      imdbId,
    };
  } catch {
    try {
      const segments = await fetchTheIntroDbSegments();
      return { source: 'theintrodb' as const, segments, imdbId };
    } catch {
      return { source: null, segments: [] as SegmentData[], imdbId };
    }
  }
});
