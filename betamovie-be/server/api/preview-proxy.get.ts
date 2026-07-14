import { createHash } from 'node:crypto';
import { request } from 'undici';
import { buildPreviewCacheKey, rewriteVttPayload } from '~/utils/preview';
import { applyCorsHeaders } from '~/utils/cors';
import {
  acquireProxySlot,
  assertSafeUpstreamUrl,
  getProxyResponseLimit,
  getProxyPoolForUrl,
  normalizeProxyHeaders,
  readResponseBytesLimited,
  requireProxyAccess,
} from '~/utils/proxySecurity';

const parseProxyHeaders = (rawHeaders: unknown): Record<string, string> => {
  if (typeof rawHeaders !== 'string') return {};
  try {
    const parsed = JSON.parse(rawHeaders);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>(
      (acc, [key, value]) => {
        if (typeof value === 'string') {
          acc[key] = value;
        }
        return acc;
      },
      {}
    );
  } catch {
    return {};
  }
};

const hashKey = (input: string) => createHash('sha256').update(input).digest('hex');

const isVttLike = (url: string, contentType: string, bytes: Buffer) => {
  if (/\.vtt(?:\?|$)/i.test(url)) {
    return true;
  }

  if ((contentType || '').toLowerCase().includes('text/vtt')) {
    return true;
  }

  return bytes.subarray(0, 6).toString('utf8') === 'WEBVTT';
};

const isImageLike = (url: string, contentType: string) => {
  if (/\.(?:avif|webp|png|jpe?g)(?:\?|$)/i.test(url)) {
    return true;
  }

  return (contentType || '').toLowerCase().startsWith('image/');
};

const setProxyHeaders = (event: any, isImage: boolean) => {
  applyCorsHeaders(event, 'GET, OPTIONS, HEAD', '*');
  setHeader(
    event,
    'cache-control',
    isImage ? 'public, max-age=900, s-maxage=3600' : 'public, max-age=300, s-maxage=1800'
  );
};

export default defineEventHandler(async event => {
  if (event.method === 'OPTIONS') {
    setProxyHeaders(event, false);
    return null;
  }

  const query = getQuery(event);
  const targetUrl = typeof query.url === 'string' ? query.url.trim() : '';
  if (!targetUrl) {
    throw createError({ statusCode: 400, statusMessage: 'Missing url' });
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = await assertSafeUpstreamUrl(targetUrl);
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unsafe upstream URL',
    });
  }

  const headers = normalizeProxyHeaders(parseProxyHeaders(query.headers));
  await requireProxyAccess(event, {
    kind: 'preview',
    targetUrl: normalizedUrl,
    headers,
  });

  const storage = useStorage('cache');
  const cacheIdentity = buildPreviewCacheKey(normalizedUrl, headers);
  const cacheKey = `preview-proxy:v1:${hashKey(cacheIdentity)}`;

  const cached = await storage
    .getItem<{ contentType: string; bodyBase64: string; isImage: boolean }>(cacheKey)
    .catch(() => null);

  if (cached?.bodyBase64) {
    setHeader(event, 'content-type', cached.contentType || 'application/octet-stream');
    setHeader(event, 'x-cache', 'HIT');
    setProxyHeaders(event, cached.isImage);
    return Buffer.from(cached.bodyBase64, 'base64');
  }

  const releaseProxySlot = acquireProxySlot();
  try {
    const pool = getProxyPoolForUrl(normalizedUrl);
    const upstreamResponse = await request(normalizedUrl, {
      method: 'GET',
      headers,
      dispatcher: pool,
      bodyTimeout: 15000,
      headersTimeout: 5000,
    });

    if (upstreamResponse.statusCode !== 200) {
      throw createError({
        statusCode: upstreamResponse.statusCode,
        statusMessage: 'Upstream error',
      });
    }

    const contentTypeHeader = upstreamResponse.headers['content-type'];
    const contentType = Array.isArray(contentTypeHeader)
      ? contentTypeHeader[0]
      : contentTypeHeader || 'application/octet-stream';
    const bytes = await readResponseBytesLimited(
      upstreamResponse.body,
      getProxyResponseLimit('preview')
    );
    const origin = getRequestURL(event).origin;

    if (isVttLike(normalizedUrl, contentType, bytes)) {
      const rewritten = rewriteVttPayload(bytes.toString('utf8'), normalizedUrl, origin, headers);
      const body = Buffer.from(rewritten, 'utf8');
      await storage
        .setItem(
          cacheKey,
          {
            contentType: 'text/vtt; charset=utf-8',
            bodyBase64: body.toString('base64'),
            isImage: false,
          },
          { ttl: 60 * 60 }
        )
        .catch(() => null);

      setHeader(event, 'content-type', 'text/vtt; charset=utf-8');
      setHeader(event, 'x-cache', 'MISS');
      setProxyHeaders(event, false);
      return body;
    }

    const imageLike = isImageLike(normalizedUrl, contentType);
    if (imageLike && bytes.length <= 5 * 1024 * 1024) {
      await storage
        .setItem(
          cacheKey,
          { contentType, bodyBase64: bytes.toString('base64'), isImage: true },
          { ttl: 15 * 60 }
        )
        .catch(() => null);
    }

    setHeader(event, 'content-type', contentType);
    setHeader(event, 'x-cache', 'MISS');
    setProxyHeaders(event, imageLike);
    return bytes;
  } finally {
    releaseProxySlot();
  }
});
