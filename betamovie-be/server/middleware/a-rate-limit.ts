import Redis from 'ioredis';
import { getProxyCapabilityKindForPath, isValidInternalApiRequest } from '~/utils/proxySecurity';

interface MemoryCacheEntry {
  count: number;
  expiry: number;
}

const memoryCache = new Map<string, MemoryCacheEntry>();
let redisClient: Redis | null = null;
let redisDisabledUntil = 0;

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memoryCache.entries()) {
    if (value.expiry < now) {
      memoryCache.delete(key);
    }
  }
}, 60_000).unref?.();

const isCapabilityPath = (path: string) => (path.split('?')[0] || '') === '/api/proxy/capability';

const getPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const DEFAULT_PROXY_RATE_LIMITS: Record<string, number> = {
  m3u8: 240,
  media: 30,
  preview: 120,
  'preview-auto': 30,
  'preview-file': 120,
  embed: 120,
  vixsrc: 120,
};

const getRateLimitConfig = (path: string) => {
  if (isCapabilityPath(path)) {
    return {
      scope: 'capability',
      windowMs: getPositiveInt(process.env.PROXY_CAPABILITY_RATE_LIMIT_WINDOW_MS, 60_000),
      maxRequests: getPositiveInt(process.env.PROXY_CAPABILITY_RATE_LIMIT_MAX_REQUESTS, 30),
      isProxyLimited: true,
    };
  }

  const kind = getProxyCapabilityKindForPath(path);
  if (kind) {
    const envPrefix = `PROXY_${kind.replace(/-/g, '_').toUpperCase()}_RATE_LIMIT`;
    return {
      scope: `proxy:${kind}`,
      windowMs: getPositiveInt(
        process.env[`${envPrefix}_WINDOW_MS`] || process.env.PROXY_RATE_LIMIT_WINDOW_MS,
        60_000
      ),
      maxRequests: getPositiveInt(
        process.env[`${envPrefix}_MAX_REQUESTS`] || process.env.PROXY_RATE_LIMIT_MAX_REQUESTS,
        DEFAULT_PROXY_RATE_LIMITS[kind] || 100
      ),
      isProxyLimited: true,
    };
  }

  return {
    scope: 'api',
    windowMs: getPositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    maxRequests: getPositiveInt(process.env.RATE_LIMIT_MAX_REQUESTS, 100),
    isProxyLimited: false,
  };
};

const getRedisClient = () => {
  if (redisClient) return redisClient;

  const redisUrl =
    process.env.REDIS_URL ||
    `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`;
  redisClient = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  redisClient.on('error', () => {});
  return redisClient;
};

const incrementRedisCounter = async (key: string, ttlMs: number) => {
  if (Date.now() < redisDisabledUntil) {
    throw new Error('Redis rate limit temporarily disabled');
  }

  const result = await getRedisClient().eval(
    'local count = redis.call("INCR", KEYS[1]); if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]); end; return count;',
    1,
    key,
    String(ttlMs)
  );
  return Number(result);
};

const incrementMemoryCounter = (key: string, windowMs: number) => {
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
  const { scope, windowMs, maxRequests, isProxyLimited } = getRateLimitConfig(path);
  const currentBucket = Math.floor(Date.now() / windowMs);
  const cacheKey = `rate-limit:${scope}:${ip}:${currentBucket}`;
  const resetTime = Math.ceil(((currentBucket + 1) * windowMs) / 1000);

  let count: number;
  try {
    count = await incrementRedisCounter(cacheKey, windowMs);
  } catch {
    redisDisabledUntil = Date.now() + 10_000;
    const failedClient = redisClient;
    redisClient = null;
    failedClient?.disconnect();

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
