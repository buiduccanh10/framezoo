import { createError, defineEventHandler, getRequestIP, setHeader } from 'h3';
import { isValidInternalApiRequest } from '~/utils/internalApi';
import { createFailFastRedis } from '~/utils/rateLimitRedis';

interface MemoryCacheEntry {
  count: number;
  expiry: number;
}

const memoryCache = new Map<string, MemoryCacheEntry>();
const rateLimitRedis = createFailFastRedis();
let redisDisabledUntil = 0;

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memoryCache.entries()) {
    if (value.expiry < now) {
      memoryCache.delete(key);
    }
  }
}, 60_000).unref?.();

interface RateLimitConfig {
  scope: string;
  windowMs: number;
  maxRequests: number;
}

const RATE_LIMIT_LUA =
  'local count = redis.call("INCR", KEYS[1]); if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]); end; return count;';

const getPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

export const getRateLimitConfig = (path: string): RateLimitConfig => {
  if (path === '/api/backup/login' || path.startsWith('/api/backup/login?')) {
    return {
      scope: 'admin-login',
      windowMs: getPositiveInt(process.env.RATE_LIMIT_ADMIN_LOGIN_WINDOW_MS, 15 * 60_000),
      maxRequests: getPositiveInt(process.env.RATE_LIMIT_ADMIN_LOGIN_MAX_REQUESTS, 5),
    };
  }

  const isAuthGuest =
    path === '/api/auth/guest' ||
    path.startsWith('/api/auth/guest?') ||
    path === '/auth/guest' ||
    path.startsWith('/auth/guest?');
  if (isAuthGuest) {
    return {
      scope: 'auth-guest',
      windowMs: getPositiveInt(process.env.RATE_LIMIT_AUTH_GUEST_WINDOW_MS, 60_000),
      maxRequests: getPositiveInt(process.env.RATE_LIMIT_AUTH_GUEST_MAX_REQUESTS, 10),
    };
  }

  const isSubtitleAlign = path.startsWith('/api/subtitle-align');
  if (isSubtitleAlign) {
    return {
      scope: 'subtitle-align',
      windowMs: getPositiveInt(process.env.RATE_LIMIT_SUBTITLE_ALIGN_WINDOW_MS, 60_000),
      maxRequests: getPositiveInt(process.env.RATE_LIMIT_SUBTITLE_ALIGN_MAX_REQUESTS, 20),
    };
  }

  if (path === '/api/ai/search' || path.startsWith('/api/ai/search?')) {
    return {
      scope: 'ai-search',
      windowMs: getPositiveInt(process.env.RATE_LIMIT_AI_SEARCH_WINDOW_MS, 60_000),
      maxRequests: getPositiveInt(process.env.RATE_LIMIT_AI_SEARCH_MAX_REQUESTS, 15),
    };
  }

  if (path === '/addon/subtitles/api/test') {
    return {
      scope: 'subtitle-key-test',
      windowMs: 60_000,
      maxRequests: 20,
    };
  }

  return {
    scope: 'api',
    windowMs: getPositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    maxRequests: getPositiveInt(process.env.RATE_LIMIT_MAX_REQUESTS, 200),
  };
};

const incrementRedisCounter = async (key: string, ttlMs: number): Promise<number> => {
  if (Date.now() < redisDisabledUntil) {
    throw new Error('Redis rate limit temporarily disabled');
  }

  const client = await rateLimitRedis.getConnectedClient();
  const result = await client.eval(RATE_LIMIT_LUA, 1, key, String(ttlMs));
  return Number(result);
};

const incrementMemoryCounter = (key: string, windowMs: number): number => {
  const now = Date.now();
  const entry = memoryCache.get(key);
  const count = entry && entry.expiry > now ? entry.count + 1 : 1;
  memoryCache.set(key, {
    count,
    expiry: now + windowMs,
  });
  return count;
};

export default defineEventHandler(async event => {
  if (event.method === 'OPTIONS') {
    return;
  }

  const path = event.path || '';
  if (path.startsWith('/healthcheck') || path.startsWith('/favicon.ico')) {
    return;
  }
  if (!path.startsWith('/metrics') && isValidInternalApiRequest(event)) {
    return;
  }

  const trustProxy = String(process.env.TRUST_PROXY).toLowerCase() === 'true';
  const ip = getRequestIP(event, { xForwardedFor: trustProxy }) || '127.0.0.1';
  const { scope, windowMs, maxRequests } = getRateLimitConfig(path);

  const identifier = ip;

  const currentBucket = Math.floor(Date.now() / windowMs);
  const cacheKey = `rate-limit:${scope}:${identifier}:${currentBucket}`;
  const resetTime = Math.ceil(((currentBucket + 1) * windowMs) / 1000);

  let count: number;
  try {
    count = await incrementRedisCounter(cacheKey, windowMs);
  } catch {
    redisDisabledUntil = Date.now() + 10_000;
    rateLimitRedis.reset();

    const failClosed = String(process.env.RATE_LIMIT_FAIL_CLOSED).toLowerCase() === 'true';
    const isSensitivePath =
      scope !== 'api' ||
      path.startsWith('/auth') ||
      path.startsWith('/api/auth') ||
      path.startsWith('/api/admin') ||
      path.startsWith('/api/backup') ||
      path.startsWith('/api/feedback');
    if (failClosed && isSensitivePath) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Service Unavailable',
        message: 'Rate limiter unavailable',
      });
    }

    count = incrementMemoryCounter(cacheKey, windowMs);
  }

  setHeader(event, 'X-RateLimit-Limit', String(maxRequests));
  setHeader(event, 'X-RateLimit-Remaining', String(Math.max(0, maxRequests - count)));
  setHeader(event, 'X-RateLimit-Reset', String(resetTime));

  if (count > maxRequests) {
    const retryAfter = Math.max(1, Math.ceil(resetTime - Date.now() / 1000));
    setHeader(event, 'Retry-After', retryAfter);
    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
    });
  }
});
