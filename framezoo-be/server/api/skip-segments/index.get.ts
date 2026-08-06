import { $fetch } from 'ofetch';
import { z } from 'zod';

const THE_INTRODB_MEDIA_URL = 'https://api.theintrodb.org/v3/media';
const INTRODB_SEGMENTS_URL = 'https://api.introdb.app/segments';

const querySchema = z
  .object({
    type: z.enum(['movie', 'show']),
    tmdbId: z.coerce.number().int().positive().optional(),
    imdbId: z
      .string()
      .trim()
      .regex(/^tt\d{7,8}$/i)
      .optional(),
    season: z.coerce.number().int().positive().optional(),
    episode: z.coerce.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.tmdbId == null && value.imdbId == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tmdbId'],
        message: 'tmdbId or imdbId is required',
      });
    }

    if (value.type === 'show') {
      if (value.season == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['season'],
          message: 'season is required for show lookups',
        });
      }
      if (value.episode == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['episode'],
          message: 'episode is required for show lookups',
        });
      }
    } else if (value.season != null || value.episode != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['season'],
        message: 'season and episode are only valid for show lookups',
      });
    }
  });

const segmentTypes = ['intro', 'recap', 'credits', 'preview'] as const;
type SegmentType = (typeof segmentTypes)[number];

interface RawSegment {
  start_ms?: number | null;
  end_ms?: number | null;
  confidence?: number | null;
  submission_count?: number | null;
}

interface RawMediaResponse {
  intro?: RawSegment[];
  recap?: RawSegment[];
  credits?: RawSegment[];
  preview?: RawSegment[];
}

interface IntroDbResponse {
  intro?: RawSegment | null;
  recap?: RawSegment | null;
  outro?: RawSegment | null;
  preview?: RawSegment | null;
}

function flattenSegments(response: RawMediaResponse) {
  return segmentTypes.flatMap(type =>
    (Array.isArray(response[type]) ? response[type] : []).map(segment => ({
      type,
      start_ms: segment.start_ms ?? null,
      end_ms: segment.end_ms ?? null,
      confidence: segment.confidence ?? null,
      submission_count: segment.submission_count ?? 1,
    }))
  );
}

function flattenIntroDbSegments(response: IntroDbResponse) {
  return [
    ['intro', response.intro],
    ['recap', response.recap],
    ['credits', response.outro],
    ['preview', response.preview],
  ].flatMap(([type, segment]) => {
    if (!segment || typeof segment !== 'object') return [];

    const rawSegment = segment as RawSegment;
    if (rawSegment.start_ms == null && rawSegment.end_ms == null) return [];

    return [
      {
        type: type as SegmentType,
        start_ms: rawSegment.start_ms ?? null,
        end_ms: rawSegment.end_ms ?? null,
        confidence: rawSegment.confidence ?? null,
        submission_count: rawSegment.submission_count ?? 1,
      },
    ];
  });
}

export default defineEventHandler(async event => {
  const parsed = querySchema.safeParse(getQuery(event));
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message || 'Invalid skip segments query',
    });
  }

  const query = parsed.data;
  const upstreamQuery = new URLSearchParams();
  if (query.tmdbId != null) upstreamQuery.set('tmdb_id', String(query.tmdbId));
  if (query.imdbId) upstreamQuery.set('imdb_id', query.imdbId);
  if (query.season != null) upstreamQuery.set('season', String(query.season));
  if (query.episode != null) upstreamQuery.set('episode', String(query.episode));

  const tidbKey = (
    (useRuntimeConfig(event).tidbApiKey as string | undefined) ||
    process.env.TIDB_API_KEY ||
    ''
  ).trim();

  try {
    const response = await $fetch<RawMediaResponse>(
      `${THE_INTRODB_MEDIA_URL}?${upstreamQuery.toString()}`,
      {
        headers: tidbKey ? { Authorization: `Bearer ${tidbKey}` } : undefined,
        retry: 0,
        timeout: 10000,
      }
    );

    return {
      source: 'theintrodb',
      segments: flattenSegments(response),
    };
  } catch (theIntroDbError: any) {
    const canUseIntroDbFallback =
      query.type === 'show' &&
      query.imdbId &&
      query.season != null &&
      query.episode != null;

    if (canUseIntroDbFallback) {
      try {
        const fallbackQuery = new URLSearchParams({
          imdb_id: query.imdbId,
          season: String(query.season),
          episode: String(query.episode),
        });
        const response = await $fetch<IntroDbResponse>(
          `${INTRODB_SEGMENTS_URL}?${fallbackQuery.toString()}`,
          {
            retry: 0,
            timeout: 10000,
          }
        );

        return {
          source: 'introdb',
          segments: flattenIntroDbSegments(response),
        };
      } catch {
        // Preserve the primary upstream error when both providers fail.
      }
    }

    const statusCode =
      theIntroDbError?.statusCode || theIntroDbError?.response?.status || 502;
    const upstreamData =
      theIntroDbError?.data || theIntroDbError?.response?._data;
    const upstreamMessage =
      typeof upstreamData?.error === 'string'
        ? upstreamData.error
        : typeof upstreamData?.message === 'string'
          ? upstreamData.message
          : 'Failed to fetch skip segments from TheIntroDB';

    throw createError({
      statusCode,
      statusMessage: upstreamMessage,
    });
  }
});
