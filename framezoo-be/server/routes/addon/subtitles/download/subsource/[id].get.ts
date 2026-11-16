import { setHeader } from 'h3';

import { resolveServerSubtitleApiKey } from '~/utils/subtitles';
import { prepareSubtitleDownload } from '~/utils/subtitles/downloadHelper';

export default defineEventHandler(async event => {
  const serverKey = resolveServerSubtitleApiKey('subsource', event) || '';
  const { subtitleId, apiKey } = await prepareSubtitleDownload(event, 'subsource', serverKey);

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
  } catch {
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
  setHeader(event, 'Cache-Control', 'private, no-store');

  return new Response(buffer, { status: 200 });
});
