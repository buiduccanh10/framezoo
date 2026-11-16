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
import {
  checkSubtitleTargetBlocked,
  getActiveTakedownBlocklist,
  isSubtitleIdBlocked,
} from '~/utils/takedown';

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
  const opensubtitlesDownloadBaseUrl = `${origin}/addon/subtitles/download/opensubtitles`;

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
    ((config.wyzieApiKey as string | undefined) || process.env.WYZIE_API_KEY || '').trim() ||
    undefined;
  const serverSubsourceApiKey =
    ((config.subsourceApiKey as string | undefined) || process.env.SUBSOURCE_API_KEY || '').trim() ||
    undefined;
  const serverOpenSubtitlesApiKey =
    (
      (config.opensubtitlesApiKey as string | undefined) ||
      process.env.OPENSUBTITLES_API_KEY ||
      ''
    ).trim() || undefined;

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
  let userSubsourceKey: string | undefined;
  let userOpenSubtitlesKey: string | undefined;
  if (authSession?.user) {
    try {
      const savedKey = await getUserProviderCredential(authSession.user);
      if (savedKey?.trim()) userWyzieKey = savedKey.trim();
      const [savedSubsource, savedOpenSubs] = await Promise.all([
        getUserProviderCredential(authSession.user, 'subsource'),
        getUserProviderCredential(authSession.user, 'opensubtitles'),
      ]);
      if (savedSubsource?.trim()) userSubsourceKey = savedSubsource.trim();
      if (savedOpenSubs?.trim()) userOpenSubtitlesKey = savedOpenSubs.trim();
    } catch (error) {
      console.warn('[subtitles:credentials] Failed to load user subtitle keys:', error);
      throw createError({
        statusCode: 503,
        statusMessage: 'Service Unavailable',
        message: 'Unable to load subtitle provider credentials',
      });
    }
  }

  const wyzieApiKey =
    userWyzieKey || (!authSession?.user ? queryWyzieKey : undefined) || serverWyzieApiKey;
  const subsourceApiKey = userSubsourceKey || serverSubsourceApiKey;
  const opensubtitlesApiKey = userOpenSubtitlesKey || serverOpenSubtitlesApiKey;

  const hasUserKey = Boolean(userWyzieKey || userSubsourceKey || userOpenSubtitlesKey);
  const credentialSource = hasUserKey
    ? 'user'
    : !authSession?.user && queryWyzieKey
      ? 'query'
      : 'server';
  const credentialScope =
    credentialSource === 'user'
      ? `user:${hashSubtitleCredential(`${authSession.user}:${wyzieApiKey || ''}:${subsourceApiKey || ''}:${opensubtitlesApiKey || ''}`)}`
      : credentialSource === 'query'
        ? `query:${hashSubtitleCredential(queryWyzieKey ?? '')}`
        : `server:${hashSubtitleCredential(`${serverWyzieApiKey ?? 'missing'}:${serverSubsourceApiKey ?? 'missing'}:${serverOpenSubtitlesApiKey ?? 'missing'}`)}`;

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

  const baseId = cleanId.split(':')[0] || cleanId;
  const directBlocked = await checkSubtitleTargetBlocked({
    imdbId: baseId.startsWith('tt') ? baseId : undefined,
    tmdbId: baseId.startsWith('tmdb:')
      ? baseId.replace('tmdb:', '')
      : /^\d+$/.test(baseId)
        ? baseId
        : undefined,
    mediaType: type,
  });
  if (directBlocked) {
    setHeader(event, 'Content-Type', 'application/json');
    setHeader(event, 'Cache-Control', 'private, no-store');
    return { subtitles: [] };
  }

  const blocklist = await getActiveTakedownBlocklist();
  const filterBlockedSubtitles = (items: Awaited<ReturnType<typeof searchAllSubtitles>>) =>
    items.filter(sub => !isSubtitleIdBlocked(sub.id, blocklist.subtitleIds));

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
        subtitles: normalizeSubtitleDownloadUrls(filterBlockedSubtitles(cachedSubtitles), origin),
      };
    }
  }

  // Deduplicate in-flight upstream search requests for the same media key
  const context = await resolveSubtitleContext(type, idStr);
  const resolvedBlocked = await checkSubtitleTargetBlocked({
    imdbId: context.imdbId,
    tmdbId: context.tmdbId,
    mediaType: type,
  });
  if (resolvedBlocked) {
    setHeader(event, 'Content-Type', 'application/json');
    setHeader(event, 'Cache-Control', 'private, no-store');
    return { subtitles: [] };
  }

  const subtitles = await executeWithInFlightDeduplication(cacheKey, async () => {
    return await searchAllSubtitles(context, {
      wyzieApiKey,
      subsourceApiKey,
      opensubtitlesApiKey,
      subsourceDownloadBaseUrl,
      opensubtitlesDownloadBaseUrl,
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
    subtitles: normalizeSubtitleDownloadUrls(filterBlockedSubtitles(subtitles), origin),
  };
});
