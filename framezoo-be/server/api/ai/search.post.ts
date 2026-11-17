import { createHash } from 'node:crypto';
import { createError, defineEventHandler, readBody } from 'h3';
import { z } from 'zod';

import { executeAiSearch, type AiSearchIntent, type AiTmdbResultItem } from '~/utils/aiSearch';
import { scopedLogger } from '~/utils/logger';
import { filterTmdbPayloadByTakedown, getActiveTakedownBlocklist } from '~/utils/takedown';

const logger = scopedLogger('ai-search');
const AI_SEARCH_CACHE_VERSION = 'v1';
const DEFAULT_CACHE_TTL_SECONDS = 1800;

const requestSchema = z.object({
  query: z.string().trim().min(2).max(300),
  language: z.string().trim().min(2).max(16).optional(),
  mediaType: z.enum(['movie', 'tv', 'all']).optional(),
});

interface CachedAiSearchPayload {
  intent: AiSearchIntent;
  results: AiTmdbResultItem[];
}

function getCacheTtlSeconds(): number {
  const parsed = Number(process.env.AI_SEARCH_CACHE_TTL || DEFAULT_CACHE_TTL_SECONDS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_CACHE_TTL_SECONDS;
}

export default defineEventHandler(async event => {
  const rawBody = await readBody(event).catch(() => null);
  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid AI search request',
      data: parsed.error.flatten(),
    });
  }

  const config = useRuntimeConfig(event);
  const gatewayUrl = ((config.aiGatewayUrl as string) || process.env.AI_GATEWAY_URL || '').trim();
  const gatewaySecret = (
    (config.aiGatewaySecret as string) ||
    process.env.AI_GATEWAY_SECRET ||
    ''
  ).trim();

  if (!gatewayUrl || !gatewaySecret) {
    throw createError({
      statusCode: 503,
      statusMessage: 'AI search is not configured',
    });
  }

  const normalizedQuery = parsed.data.query.replace(/\s+/g, ' ').trim();
  const language = parsed.data.language || 'en-US';
  const mediaType = parsed.data.mediaType || 'all';

  const blocklist = await getActiveTakedownBlocklist();
  const storage = useStorage('cache');
  const hash = createHash('sha256')
    .update(`${normalizedQuery.toLowerCase()}|${language.toLowerCase()}|${mediaType}`)
    .digest('hex');
  const cacheKey = `ai-search:${AI_SEARCH_CACHE_VERSION}:${hash}`;

  try {
    const cached = await storage.getItem<CachedAiSearchPayload>(cacheKey);
    if (cached && Array.isArray(cached.results)) {
      const filtered = filterTmdbPayloadByTakedown({ results: cached.results }, blocklist);
      return {
        ok: true,
        cached: true,
        intent: cached.intent,
        results: filtered?.results ?? [],
      };
    }
  } catch (err) {
    logger.warn('AI search cache read failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const payload = await executeAiSearch({
      query: normalizedQuery,
      language,
      mediaType,
      gatewayUrl,
      gatewaySecret,
    });

    try {
      await storage.setItem(cacheKey, payload, { ttl: getCacheTtlSeconds() });
    } catch (err) {
      logger.warn('AI search cache write failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }

    const filtered = filterTmdbPayloadByTakedown({ results: payload.results }, blocklist);
    return {
      ok: true,
      cached: false,
      intent: payload.intent,
      results: filtered?.results ?? [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout =
      message.toLowerCase().includes('timeout') || message.toLowerCase().includes('abort');
    logger.error('AI search failed', { message });
    throw createError({
      statusCode: isTimeout ? 504 : 502,
      statusMessage: isTimeout ? 'AI search gateway timeout' : 'AI search failed',
    });
  }
});
