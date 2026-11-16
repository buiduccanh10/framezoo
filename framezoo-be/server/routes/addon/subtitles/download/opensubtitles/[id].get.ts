import { createError, setHeader } from 'h3';

import { prepareSubtitleDownload } from '~/utils/subtitles/downloadHelper';

interface OpenSubtitlesDownloadResponse {
  link?: string;
}

export default defineEventHandler(async event => {
  const config = useRuntimeConfig();
  const serverKey =
    (config.opensubtitlesApiKey as string | undefined) || process.env.OPENSUBTITLES_API_KEY || '';
  const { subtitleId, apiKey } = await prepareSubtitleDownload(
    event,
    'opensubtitles',
    serverKey
  );

  const fileId = Number.parseInt(subtitleId, 10);
  if (!Number.isFinite(fileId) || fileId <= 0) {
    throw createError({ statusCode: 400, message: 'Invalid OpenSubtitles file_id' });
  }

  let downloadMetaRes: Response;
  try {
    downloadMetaRes = await fetch('https://api.opensubtitles.com/api/v1/download', {
      method: 'POST',
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Framezoo v1.0.0',
      },
      body: JSON.stringify({ file_id: fileId }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw createError({
      statusCode: 502,
      message: 'Failed to request download link from OpenSubtitles',
    });
  }

  if (!downloadMetaRes.ok) {
    throw createError({
      statusCode: downloadMetaRes.status,
      message: `OpenSubtitles returned ${downloadMetaRes.status}`,
    });
  }

  const meta = (await downloadMetaRes.json()) as OpenSubtitlesDownloadResponse;
  if (!meta?.link) {
    throw createError({ statusCode: 502, message: 'Missing download link from OpenSubtitles' });
  }

  const fileRes = await fetch(meta.link, { signal: AbortSignal.timeout(15_000) });
  if (!fileRes.ok) {
    throw createError({
      statusCode: fileRes.status,
      message: 'Failed to fetch subtitle file from signed OpenSubtitles URL',
    });
  }

  const buffer = await fileRes.arrayBuffer();
  const contentType = fileRes.headers.get('content-type') || 'text/plain; charset=utf-8';

  setHeader(event, 'Content-Type', contentType);
  setHeader(event, 'Cache-Control', 'private, no-store');

  return new Response(buffer, { status: 200 });
});
