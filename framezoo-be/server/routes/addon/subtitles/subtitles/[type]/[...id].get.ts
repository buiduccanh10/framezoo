import { getQuery, getRequestHeader, setHeader } from 'h3';

import { resolveSubtitleContext, searchAllSubtitles } from '~/utils/subtitles';

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

  const host = getRequestHeader(event, 'host') || 'localhost:3000';
  const proto = getRequestHeader(event, 'x-forwarded-proto') || 'http';
  const origin = `${proto}://${host}`;
  const subsourceDownloadBaseUrl = `${origin}/addon/subtitles/download/subsource`;

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

  const query = getQuery(event);
  const acceptLanguage = getRequestHeader(event, 'accept-language') || '';
  const preferredLanguages: string[] = [];

  if (typeof query.language === 'string') {
    preferredLanguages.push(...query.language.split(',').map(s => s.trim().toLowerCase()));
  }
  if (typeof query.languages === 'string') {
    preferredLanguages.push(...query.languages.split(',').map(s => s.trim().toLowerCase()));
  }
  if (acceptLanguage) {
    const headerLangs = acceptLanguage
      .split(',')
      .map(part => part.split(';')[0].trim().toLowerCase().split('-')[0])
      .filter(Boolean);
    preferredLanguages.push(...headerLangs);
  }

  const context = await resolveSubtitleContext(type, idStr);

  const subtitles = await searchAllSubtitles(context, {
    wyzieApiKey,
    subsourceApiKey,
    subsourceDownloadBaseUrl,
    preferredLanguages: Array.from(new Set(preferredLanguages.filter(Boolean))),
  });

  setHeader(event, 'Content-Type', 'application/json');
  // Subtitle availability can change between episode transitions. React Query
  // owns the client-side cache; do not let browser/CDN cache hide a refresh.
  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  setHeader(event, 'Pragma', 'no-cache');
  setHeader(event, 'Expires', '0');

  return {
    subtitles,
  };
});
