import { getQuery, getRequestHeader, setHeader } from 'h3';

import {
  EMPTY_SUBTITLE_CACHE_TTL,
  executeWithInFlightDeduplication,
  getCachedSubtitles,
  getSubtitleCacheKey,
  getSubtitleTtl,
  hashSubtitleCredential,
  normalizeSubtitleDownloadUrls,
  resolveServerSubtitleApiKey,
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

  const serverWyzieApiKey = resolveServerSubtitleApiKey('wyzie', event);
  const serverSubsourceApiKey = resolveServerSubtitleApiKey('subsource', event);
  const serverOpenSubtitlesApiKey = resolveServerSubtitleApiKey('opensubtitles', event);

  // Query keys are for unauthenticated Stremio URLs. An authenticated native
  // request must use its account key or the server fallback.
  const queryWyzieKey =
    typeof query.key === 'string' && query.key.trim() ? query.key.trim() : undefined;

  let authSession;
  try {
    authSession =
      event.context.session ||
      (event.context.isGuest ? null : await useAuth().getOptionalCurrentSessionForEvent(event));
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
        ? `query:${hashSubtitleCredential(`${queryWyzieKey ?? ''}:${serverSubsourceApiKey ?? 'missing'}:${serverOpenSubtitlesApiKey ?? 'missing'}`)}`
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
  const languageKey = searchLanguages.join(',') || 'all';
  const cacheKey = getSubtitleCacheKey(type, cleanId, credentialScope, languageKey);
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

  type SubtitleSearchResult = Awaited<ReturnType<typeof searchAllSubtitles>>;
  const blocklist = await getActiveTakedownBlocklist();
  const filterBlockedSubtitles = (items: SubtitleSearchResult): SubtitleSearchResult =>
    items.filter(sub => !isSubtitleIdBlocked(sub.id, blocklist.subtitleIds));

  // Resolve IMDb <-> TMDB IDs before reading shared cache when media-level takedowns exist,
  // preventing cached responses from bypassing a rule created under the alternate ID.
  let context: Awaited<ReturnType<typeof resolveSubtitleContext>> | null = null;
  if (blocklist.tmdbIds.length > 0 || blocklist.imdbIds.length > 0) {
    context = await resolveSubtitleContext(type, idStr);
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
  }

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
  if (!context) {
    context = await resolveSubtitleContext(type, idStr);
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
  }

  const searchContext = context;
  let ranSearch = false;
  let hadProviderFailure = false;
  const runSearch = (): ReturnType<typeof searchAllSubtitles> => {
    ranSearch = true;
    return searchAllSubtitles(searchContext, {
      wyzieApiKey,
      subsourceApiKey,
      opensubtitlesApiKey,
      subsourceDownloadBaseUrl,
      opensubtitlesDownloadBaseUrl,
      preferredLanguages: searchLanguages,
      onProviderError: () => {
        hadProviderFailure = true;
      },
    });
  };
  const subtitles = await executeWithInFlightDeduplication(cacheKey, runSearch);

  if (ranSearch) {
    const ttl = hadProviderFailure
      ? EMPTY_SUBTITLE_CACHE_TTL
      : getSubtitleTtl(type, subtitles.length);
    await setCachedSubtitles(cacheKey, subtitles, ttl);
  }

  setHeader(event, 'Content-Type', 'application/json');
  setHeader(event, 'X-Cache', 'MISS');
  setHeader(event, 'Cache-Control', cacheControl);
  setHeader(event, 'Vary', 'Authorization, Cookie, Accept-Language');

  return {
    subtitles: normalizeSubtitleDownloadUrls(filterBlockedSubtitles(subtitles), origin),
  };
});
