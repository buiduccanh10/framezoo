import { setHeader } from 'h3';

export default defineEventHandler(async event => {
  const params = event.context.params as { id?: string } | undefined;
  const subtitleId = params?.id?.replace(/\.(srt|vtt|zip|json)$/, '').trim();

  if (!subtitleId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Missing subtitle id',
    });
  }

  const config = useRuntimeConfig();
  const apiKey =
    ((config.subsourceApiKey as string | undefined) || process.env.SUBSOURCE_API_KEY || '').trim();

  if (!apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'SubSource API key is not configured on server',
    });
  }

  const targetUrl = `https://api.subsource.net/api/v1/subtitles/${encodeURIComponent(subtitleId)}/download`;

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'api-key': apiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err: unknown) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: 'Failed to download subtitle from SubSource',
    });
  }

  if (!response.ok) {
    throw createError({
      statusCode: response.status,
      statusMessage: response.statusText,
      message: `SubSource returned ${response.status}`,
    });
  }

  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || 'application/octet-stream';

  setHeader(event, 'Content-Type', contentType);
  setHeader(event, 'Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

  return new Response(buffer, { status: 200 });
});
