import type { H3Event } from 'h3';
import { applyCorsHeaders } from '~/utils/cors';
import {
  acquireProxySlot,
  assertSafeUpstreamUrl,
  fetchSafeUpstream,
  getProxyResponseLimit,
  normalizeProxyHeaders,
  readWebResponseBytesLimited,
  requireProxyAccess,
} from '~/utils/proxySecurity';

const MODERN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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

export const handleVixsrcProxy = async (event: H3Event) => {
  if (event.method === 'OPTIONS') {
    applyCorsHeaders(event, 'GET, HEAD, OPTIONS', '*');
    setResponseStatus(event, 204);
    return null;
  }

  if (event.method !== 'GET' && event.method !== 'HEAD') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method not allowed',
    });
  }

  const query = getQuery(event);
  const rawUrl = typeof query.url === 'string' ? query.url.trim() : '';
  if (!rawUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'URL parameter is required',
    });
  }

  let targetUrl: string;
  try {
    targetUrl = await assertSafeUpstreamUrl(rawUrl);
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unsafe URL parameter',
    });
  }

  const headers = normalizeProxyHeaders(parseProxyHeaders(query.headers));
  await requireProxyAccess(event, {
    kind: 'vixsrc',
    targetUrl,
    headers,
  });

  const finalHeaders: Record<string, string> = {
    'User-Agent': MODERN_UA,
    Accept:
      'application/x-mpegURL, application/vnd.apple.mpegURL, video/mpegURL, video/mp4, application/vnd.apple.mpegURL, application/x-mpeg',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate',
    ...headers,
  };

  const releaseProxySlot = acquireProxySlot();

  try {
    const response = await fetchSafeUpstream(targetUrl, {
      method: event.method,
      headers: finalHeaders,
    });

    if (!response.ok) {
      throw createError({
        statusCode: response.status,
        statusMessage: response.statusText || 'Failed to fetch stream',
      });
    }

    const maxBytes = getProxyResponseLimit('vixsrc');
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) {
      throw createError({
        statusCode: 413,
        statusMessage: 'Upstream response exceeds the configured size limit',
      });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const upstreamLength = response.headers.get('content-length');
    let bytes: Buffer;
    if (event.method === 'HEAD') {
      await response.body?.cancel().catch(() => null);
      bytes = Buffer.alloc(0);
    } else {
      bytes = await readWebResponseBytesLimited(response, maxBytes);
    }

    setHeader(event, 'content-type', contentType);
    applyCorsHeaders(event, 'GET, HEAD, OPTIONS', '*');
    setHeader(
      event,
      'content-length',
      event.method === 'HEAD' ? Number(upstreamLength || 0) : bytes.length
    );
    return bytes;
  } catch (error: any) {
    console.warn('[vixsrc-proxy] upstream request failed', error);
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error;
    }
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to proxy stream',
    });
  } finally {
    releaseProxySlot();
  }
};
