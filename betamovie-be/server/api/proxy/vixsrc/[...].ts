import type { H3Event } from 'h3';
import { applyCorsHeaders } from '~/utils/cors';

/**
 * Vixsrc-specific stream proxy
 * Proxies requests to vixsrc.to with proper headers to avoid CORS and ensure playback
 */

const MODERN_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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

export default defineEventHandler(async (event: H3Event) => {
  if (event.method === 'OPTIONS') {
    applyCorsHeaders(event, 'GET, OPTIONS', '*');
    event.node.res.statusCode = 204;
    return null;
  }

  const query = getQuery(event);
  const url = query.url as string;

  if (!url) {
    throw createError({
      statusCode: 400,
      statusMessage: 'URL parameter is required',
    });
  }

  // Parse headers from frontend (if provided)
  const headers = parseProxyHeaders(query.headers);
  
  // Default vixsrc headers
  const vixsrcHeaders: Record<string, string> = {
    'User-Agent': MODERN_UA,
    Accept: 'application/x-mpegURL, application/vnd.apple.mpegURL, video/mpegURL, video/mp4, application/vnd.apple.mpegURL, application/x-mpeg',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate',
    Connection: 'keep-alive',
  };

  // Merge with custom headers from frontend
  const finalHeaders = { ...vixsrcHeaders, ...headers };

  console.log(`[Vixsrc Proxy] Proxying: ${url.substring(0, 80)}...`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: finalHeaders,
    });

    if (!response.ok) {
      console.error(`[Vixsrc Proxy] Error: ${response.status} ${response.statusText}`);
      throw createError({
        statusCode: response.status,
        statusMessage: response.statusText || 'Failed to fetch stream',
      });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    console.log(`[Vixsrc Proxy] Successfully proxied ${bytes.length} bytes`);

    // Set appropriate content-type
    setHeader(event, 'content-type', contentType);
    applyCorsHeaders(event, 'GET, OPTIONS', '*');

    return bytes;
  } catch (error: any) {
    console.error(`[Vixsrc Proxy] Request failed:`, error.message);
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to proxy stream',
      data: error.message,
    });
  }
});
