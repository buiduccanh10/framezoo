import { applyCorsHeaders } from '~/utils/cors';
import {
  buildPreviewFileResource,
  isValidPreviewAssetFile,
  isValidPreviewAssetKey,
  parsePreviewFileResource,
} from '~/utils/preview';
import {
  acquireProxySlot,
  fetchWithTimeout,
  getProxyResponseLimit,
  getProxyUpstreamTimeoutMs,
  requireProxyAccess,
  readWebResponseBytesLimited,
} from '~/utils/proxySecurity';
const PREVIEW_SERVICE_URL = process.env.PREVIEW_SERVICE_URL || 'http://127.0.0.1:3100';

// Universal route keeps the explicit HEAD handling reachable in Nitro.
const setPreviewHeaders = (event: any) => {
  applyCorsHeaders(event, 'GET, OPTIONS, HEAD', '*');
  setHeader(event, 'cache-control', 'public, max-age=900, s-maxage=3600');
};

export default defineEventHandler(async event => {
  if (event.method === 'OPTIONS') {
    setPreviewHeaders(event);
    return null;
  }
  if (event.method !== 'GET' && event.method !== 'HEAD') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' });
  }

  const query = getQuery(event);
  const resource = typeof query.resource === 'string' ? query.resource : '';
  const parsedResource = resource ? parsePreviewFileResource(resource) : null;
  const key =
    parsedResource?.key || (resource ? '' : typeof query.key === 'string' ? query.key : '');
  const file =
    parsedResource?.file || (resource ? '' : typeof query.file === 'string' ? query.file : '');

  if (!key || !file || !isValidPreviewAssetKey(key) || !isValidPreviewAssetFile(file)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid preview asset' });
  }

  await requireProxyAccess(event, {
    kind: 'preview-file',
    resource: resource || buildPreviewFileResource(key, file),
  });

  const releaseProxySlot = acquireProxySlot();
  try {
    const upstream = await fetchWithTimeout(
      `${PREVIEW_SERVICE_URL}/files/${encodeURIComponent(key)}/${encodeURIComponent(file)}`,
      { method: 'GET' },
      getProxyUpstreamTimeoutMs()
    );

    if (!upstream.ok) {
      throw createError({
        statusCode: upstream.status,
        statusMessage: 'Preview asset not found',
      });
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    setHeader(event, 'content-type', contentType);
    setPreviewHeaders(event);

    if (event.method === 'HEAD') {
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) {
        setHeader(event, 'content-length', Number(contentLength));
        event.node.res.setHeader('content-length', contentLength);
      }
      await upstream.body?.cancel().catch(() => null);
      event.node.res.end();
      return null;
    }

    const bytes = await readWebResponseBytesLimited(upstream, getProxyResponseLimit('preview'));
    setHeader(event, 'content-length', bytes.length);
    return bytes;
  } finally {
    releaseProxySlot();
  }
});
