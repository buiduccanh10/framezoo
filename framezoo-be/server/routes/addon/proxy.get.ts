import { getQuery, setHeader } from 'h3';

/**
 * Addon Proxy Endpoint
 *
 * Forwards requests to external Stremio-compatible addon servers on behalf
 * of the client. This bypasses CORS restrictions since the request originates
 * from the server, not the browser.
 *
 * Security measures:
 * - Only allows HTTPS URLs
 * - Blocks requests to private/internal IP ranges (SSRF protection)
 * - Enforces a response size limit to prevent memory exhaustion
 * - Rate-limiting is handled globally by the a-rate-limit middleware
 *
 * Usage: GET /addon/proxy?url=https%3A%2F%2Ftorrentio.strem.fun%2Fstream%2Fmovie%2Ftt1877830.json
 */

const MAX_RESPONSE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Patterns that match private/internal network addresses (SSRF protection) */
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^0\.0\.0\.0$/,
  /^169\.254\./, // link-local
  /^fd[0-9a-f]{2}:/i, // unique local IPv6
];

function isBlockedHost(hostname: string): boolean {
  return BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

function validateProxyUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Invalid URL provided.',
    });
  }

  if (parsed.protocol !== 'https:') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Only HTTPS URLs are allowed.',
    });
  }

  if (isBlockedHost(parsed.hostname)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'Requests to internal or private addresses are not allowed.',
    });
  }

  return parsed;
}

export default defineEventHandler(async (event) => {
  const { url } = getQuery(event);

  if (!url || typeof url !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Missing required query parameter: url',
    });
  }

  const targetUrl = validateProxyUrl(url);

  let response: Response;
  try {
    response = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'FrameZoo/1.0 (compatible; addon-proxy)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000), // 15s timeout
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error && err.name === 'TimeoutError'
        ? 'Addon server did not respond in time.'
        : 'Failed to reach the addon server.';
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message,
    });
  }

  if (!response.ok) {
    throw createError({
      statusCode: response.status,
      statusMessage: response.statusText,
      message: `Addon server responded with status ${response.status}.`,
    });
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_RESPONSE_SIZE_BYTES) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: 'Addon response exceeds the maximum allowed size.',
    });
  }

  const buffer = await response.arrayBuffer();

  if (buffer.byteLength > MAX_RESPONSE_SIZE_BYTES) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: 'Addon response exceeds the maximum allowed size.',
    });
  }

  // Forward content-type from the origin addon server
  const contentType =
    response.headers.get('content-type') || 'application/json';

  setHeader(event, 'Content-Type', contentType);
  setHeader(event, 'Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  setHeader(event, 'X-Proxied-From', targetUrl.hostname);

  return new Response(buffer, { status: 200 });
});
