import { getQuery, getRequestHeader, setHeader } from 'h3';

import {
  executeWithInFlightDeduplication,
  getCachedSubtitles,
  getSubtitleCacheKey,
  getSubtitleTtl,
  normalizeSubtitleDownloadUrls,
  resolveSubtitleContext,
  searchAllSubtitles,
} from '~/utils/subtitles';

export default defineEventHandler(async event => {
  const params = event.context.params as { type?: string; id?: string | string[] } | undefined;
  const rawType = params?.type;
  const rawIdParam = params?.id;

  if (!rawType || !rawIdParam) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Missing type or id parameters',
    });
  }

  const type = rawType === 'series' ? 'series' : 'movie';
  const idStr = Array.isArray(rawIdParam) ? rawIdParam.join('/') : rawIdParam;
  const cleanId = decodeURIComponent(idStr)
    .replace(/\.json$/, '')
    .trim();

  const host =
    getRequestHeader(event, 'x-forwarded-host') ||
    getRequestHeader(event, 'host') ||
    'localhost:3000';
  const proto = getRequestHeader(event, 'x-forwarded-proto') || 'http';
  const origin = `${proto}://${host}`;
  const subsourceDownloadBaseUrl = `${origin}/addon/subtitles/download/subsource`;

  const query = getQuery(event);
  const cacheControlHeader = getRequestHeader(event, 'cache-control') || '';
  const pragmaHeader = getRequestHeader(event, 'pragma') || '';
  const isForceRefresh =
    query.reload !== undefined ||
    query.force !== undefined ||
    query.refresh !== undefined ||
    cacheControlHeader.includes('no-cache') ||
    pragmaHeader.includes('no-cache');

  const cacheKey = getSubtitleCacheKey(type, cleanId);

  // Serve from Redis cache if available and not a forced reload
  if (!isForceRefresh) {
    const cachedSubtitles = await getCachedSubtitles(cacheKey);
    if (cachedSubtitles) {
      setHeader(event, 'Content-Type', 'application/json');
      setHeader(event, 'X-Cache', 'HIT');
      setHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');

      return {
        subtitles: normalizeSubtitleDownloadUrls(cachedSubtitles, origin),
      };
    }
  }

  const config = useRuntimeConfig();
  const wyzieApiKey =
    ((config.wyzieApiKey as string | undefined) || process.env.WYZIE_API_KEY || '').trim() ||
    undefined;
  const subsourceApiKey =
    (
      (config.subsourceApiKey as string | undefined) ||
      process.env.SUBSOURCE_API_KEY ||
      ''
    ).trim() || undefined;

  const acceptLanguage = getRequestHeader(event, 'accept-language') || '';
  const preferredLanguages: string[] = [];
  const addPreferredLanguages = (raw: string) => {
    for (const value of raw.split(',')) {
      const language = value.trim().toLowerCase().split(';')[0].split('-')[0];
      if (!/^[a-z]{2,3}$/.test(language) || preferredLanguages.includes(language)) continue;
      preferredLanguages.push(language);
      if (preferredLanguages.length >= 8) break;
    }
  };

  if (typeof query.language === 'string') {
    addPreferredLanguages(query.language);
  }
  if (typeof query.languages === 'string') {
    addPreferredLanguages(query.languages);
  }
  if (acceptLanguage) {
    addPreferredLanguages(acceptLanguage);
  }

  const searchLanguages = Array.from(new Set(['vi', 'en', ...preferredLanguages].filter(Boolean)));

  // Deduplicate in-flight upstream search requests for the same media key
  const subtitles = await executeWithInFlightDeduplication(cacheKey, async () => {
    const context = await resolveSubtitleContext(type, idStr);
    return await searchAllSubtitles(context, {
      wyzieApiKey,
      subsourceApiKey,
      subsourceDownloadBaseUrl,
      preferredLanguages: searchLanguages,
    });
  });

  const ttl = getSubtitleTtl(type, subtitles.length);
  await setCachedSubtitles(cacheKey, subtitles, ttl);

  setHeader(event, 'Content-Type', 'application/json');
  setHeader(event, 'X-Cache', 'MISS');
  setHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');

  return {
    subtitles: normalizeSubtitleDownloadUrls(subtitles, origin),
  };
});
