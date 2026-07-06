interface MemoryCacheEntry {
  count: number;
  expiry: number;
}

const memoryCache = new Map<string, MemoryCacheEntry>();

// Clean up memory cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of memoryCache.entries()) {
    if (value.expiry < now) {
      memoryCache.delete(key);
    }
  }
}, 60_000).unref?.();

export default defineEventHandler(async event => {
  if (event.method === 'OPTIONS') {
    return;
  }

  const path = event.path || '';
  if (
    path.startsWith('/healthcheck') ||
    path.startsWith('/metrics') ||
    path.startsWith('/favicon.ico')
  ) {
    return;
  }

  const ip = getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1';

  // Read configurations
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  const maxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 100);

  const currentBucket = Math.floor(Date.now() / windowMs);
  const cacheKey = `rate-limit:${ip}:${currentBucket}`;

  const storage = useStorage('cache');
  let count = 0;
  let usingRedis = true;

  try {
    const cached = await storage.getItem<number>(cacheKey);
    count = cached || 0;
  } catch (err) {
    usingRedis = false;
    const now = Date.now();
    const entry = memoryCache.get(cacheKey);
    if (entry && entry.expiry > now) {
      count = entry.count;
    } else {
      count = 0;
    }
  }

  const resetTime = Math.ceil((currentBucket + 1) * windowMs / 1000);

  if (count >= maxRequests) {
    const retryAfter = Math.max(1, Math.ceil(resetTime - Date.now() / 1000));

    setHeader(event, 'X-RateLimit-Limit', String(maxRequests));
    setHeader(event, 'X-RateLimit-Remaining', '0');
    setHeader(event, 'X-RateLimit-Reset', String(resetTime));
    setHeader(event, 'Retry-After', retryAfter);

    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
    });
  }

  count += 1;

  if (usingRedis) {
    try {
      await storage.setItem(cacheKey, count, { ttl: windowMs / 1000 });
    } catch {
      memoryCache.set(cacheKey, {
        count,
        expiry: Date.now() + windowMs,
      });
    }
  } else {
    memoryCache.set(cacheKey, {
      count,
      expiry: Date.now() + windowMs,
    });
  }

  setHeader(event, 'X-RateLimit-Limit', String(maxRequests));
  setHeader(event, 'X-RateLimit-Remaining', String(Math.max(0, maxRequests - count)));
  setHeader(event, 'X-RateLimit-Reset', String(resetTime));
});
