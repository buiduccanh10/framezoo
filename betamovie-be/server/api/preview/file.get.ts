import { applyCorsHeaders } from '~/utils/cors';
const PREVIEW_SERVICE_URL = process.env.PREVIEW_SERVICE_URL || 'http://127.0.0.1:3100';

const setPreviewHeaders = (event: any) => {
  applyCorsHeaders(event, 'GET, OPTIONS, HEAD', '*');
  setHeader(event, 'cache-control', 'public, max-age=900, s-maxage=3600');
};

export default defineEventHandler(async event => {
  if (event.method === 'OPTIONS') {
    setPreviewHeaders(event);
    return null;
  }

  const query = getQuery(event);
  const key = typeof query.key === 'string' ? query.key : '';
  const file = typeof query.file === 'string' ? query.file : '';

  if (!key || !file) {
    throw createError({ statusCode: 400, statusMessage: 'Missing key or file' });
  }

  const upstream = await fetch(
    `${PREVIEW_SERVICE_URL}/files/${encodeURIComponent(key)}/${encodeURIComponent(file)}`
  );

  if (!upstream.ok) {
    throw createError({
      statusCode: upstream.status,
      statusMessage: 'Preview asset not found',
    });
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const bytes = Buffer.from(await upstream.arrayBuffer());

  setHeader(event, 'content-type', contentType);
  setPreviewHeaders(event);
  return bytes;
});
