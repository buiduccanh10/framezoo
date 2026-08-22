import { getRequestHeader, setHeader } from 'h3';

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
    ((config.subsourceApiKey as string | undefined) || process.env.SUBSOURCE_API_KEY || '').trim() ||
    undefined;

  const context = await resolveSubtitleContext(type, idStr);
  const subtitles = await searchAllSubtitles(context, {
    wyzieApiKey,
    subsourceApiKey,
    subsourceDownloadBaseUrl,
  });

  setHeader(event, 'Content-Type', 'application/json');
  setHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=1800');

  return {
    subtitles,
  };
});
