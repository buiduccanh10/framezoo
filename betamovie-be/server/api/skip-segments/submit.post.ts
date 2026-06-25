import { z } from 'zod';
import { $fetch } from 'ofetch';

const THE_INTRODB_SUBMIT_URL = 'https://api.theintrodb.org/v1/submit';

const submissionSchema = z
  .object({
    tmdb_id: z.coerce.number().int().positive(),
    type: z.enum(['movie', 'tv']),
    segment: z.enum(['intro', 'recap', 'credits', 'preview']),
    season: z.coerce.number().int().positive().optional(),
    episode: z.coerce.number().int().positive().optional(),
    start_sec: z.coerce.number().nonnegative().nullable().optional(),
    end_sec: z.coerce.number().nonnegative().nullable().optional(),
    start_ms: z.coerce.number().nonnegative().nullable().optional(),
    end_ms: z.coerce.number().nonnegative().nullable().optional(),
    tvdb_id: z.coerce.number().int().positive().optional(),
    imdb_id: z
      .string()
      .trim()
      .regex(/^tt\d{7,8}$/i)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'tv') {
      if (!value.season) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['season'],
          message: 'season is required for tv submissions',
        });
      }
      if (!value.episode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['episode'],
          message: 'episode is required for tv submissions',
        });
      }
    }

    const hasStart = value.start_sec != null || value.start_ms != null;
    const hasEnd = value.end_sec != null || value.end_ms != null;

    if ((value.segment === 'intro' || value.segment === 'recap') && !hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end_sec'],
        message: 'end time is required for intro and recap submissions',
      });
    }

    if ((value.segment === 'credits' || value.segment === 'preview') && !hasStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['start_sec'],
        message: 'start time is required for credits and preview submissions',
      });
    }
  });

export default defineEventHandler(async event => {
  const tidbKey =
    ((useRuntimeConfig(event).tidbApiKey as string | undefined) || process.env.TIDB_API_KEY || '').trim() ||
    null;

  if (!tidbKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'TheIntroDB submission is not configured on the backend',
    });
  }

  const body = await readBody(event);
  const parsed = submissionSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message || 'Invalid submission payload',
    });
  }

  try {
    return await $fetch(THE_INTRODB_SUBMIT_URL, {
      method: 'POST',
      body: parsed.data,
      headers: {
        Authorization: `Bearer ${tidbKey}`,
      },
      retry: 0,
      timeout: 10000,
    });
  } catch (error: any) {
    const statusCode = error?.statusCode || error?.response?.status || 502;
    const upstreamData = error?.data || error?.response?._data;
    const upstreamMessage =
      typeof upstreamData?.error === 'string'
        ? upstreamData.error
        : typeof upstreamData?.message === 'string'
          ? upstreamData.message
          : 'Failed to submit segments to TheIntroDB';

    throw createError({
      statusCode,
      statusMessage: upstreamMessage,
      data:
        typeof upstreamData?.details === 'string'
          ? {
              details: upstreamData.details,
            }
          : undefined,
    });
  }
});
