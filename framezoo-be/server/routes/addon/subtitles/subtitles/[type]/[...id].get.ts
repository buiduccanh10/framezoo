import { getQuery, getRequestHeader, setHeader } from 'h3';

import {
  executeWithInFlightDeduplication,
  getCachedSubtitles,
  getSubtitleCacheKey,
  getSubtitleTtl,
  hashSubtitleCredential,
  normalizeSubtitleDownloadUrls,
  resolveSubtitleContext,
  searchAllSubtitles,
} from '~/utils/subtitles';
import { getUserProviderCredential } from '~/utils/providerCredentials';

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

  const config = useRuntimeConfig();
  const serverWyzieApiKey =
    (config.wyzieApiKey || process.env.WYZIE_API_KEY || '').trim() || undefined;

  // Query keys are for unauthenticated Stremio URLs. An authenticated native
  // request must use its account key or the server fallback.
  const queryWyzieKey =
    typeof query.key === 'string' && query.key.trim() ? query.key.trim() : undefined;

  let authSession;
  try {
    authSession =
      event.context.session || (await useAuth().getOptionalCurrentSessionForEvent(event));
  } catch (error) {
    console.warn('[subtitles:auth] Failed to resolve request session:', error);
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Unable to resolve subtitle provider credentials',
    });
  }

  let userWyzieKey: string | undefined;
  if (authSession?.user) {
    try {
      const savedKey = await getUserProviderCredential(authSession.user);
      if (savedKey?.trim()) userWyzieKey = savedKey.trim();
    } catch (error) {
      console.warn('[subtitles:credentials] Failed to load user Wyzie key:', error);
      throw createError({
        statusCode: 503,
        statusMessage: 'Service Unavailable',
        message: 'Unable to load subtitle provider credentials',
      });
    }
  }

  const wyzieApiKey =
    userWyzieKey || (!authSession?.user ? queryWyzieKey : undefined) || serverWyzieApiKey;
  const credentialSource = userWyzieKey
    ? 'user'
    : !authSession?.user && queryWyzieKey
      ? 'query'
      : 'server';
  const credentialScope =
    credentialSource === 'user'
      ? `user:${hashSubtitleCredential(`${authSession.user}:${userWyzieKey}`)}`
      : credentialSource === 'query'
        ? `query:${hashSubtitleCredential(queryWyzieKey ?? '')}`
        : `server:${hashSubtitleCredential(serverWyzieApiKey ?? 'missing')}`;

  const subsourceApiKey =
    (
      (config.subsourceApiKey as string | undefined) ||
      process.env.SUBSOURCE_API_KEY ||
      ''
    ).trim() || undefined;

  const acceptLanguage = getRequestHeader(event, 'accept-language') || '';
  const preferredLanguages: string[] = [];
  const addPreferredLanguages = (raw: string): void => {
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
  const cacheKey = getSubtitleCacheKey(
    type,
    cleanId,
    credentialScope,
    searchLanguages.join(',') || 'all',
  );
  const cacheControl =
    credentialSource === 'server'
      ? 'public, max-age=300, stale-while-revalidate=3600'
      : 'private, no-store';

  // Credential scope is resolved before reading shared cache or joining an
  // in-flight search. This prevents cross-user/provider-key result reuse.
  if (!isForceRefresh) {
    const cachedSubtitles = await getCachedSubtitles(cacheKey);
    if (cachedSubtitles) {
      setHeader(event, 'Content-Type', 'application/json');
      setHeader(event, 'X-Cache', 'HIT');
      setHeader(event, 'Cache-Control', cacheControl);
      setHeader(event, 'Vary', 'Authorization, Cookie, Accept-Language');

      return {
        subtitles: normalizeSubtitleDownloadUrls(cachedSubtitles, origin),
      };
    }
  }

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
  setHeader(event, 'Cache-Control', cacheControl);
  setHeader(event, 'Vary', 'Authorization, Cookie, Accept-Language');

  return {
    subtitles: normalizeSubtitleDownloadUrls(subtitles, origin),
  };
});
