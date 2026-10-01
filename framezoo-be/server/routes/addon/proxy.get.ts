import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';
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
  return BLOCKED_HOST_PATTERNS.some(pattern => pattern.test(hostname));
}

function isBlockedIPv4Address(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some(value => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return true;
  }
  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && b >= 18 && b <= 19) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function isBlockedAddress(address: string): boolean {
  if (isIP(address) === 4) {
    return isBlockedIPv4Address(address);
  }

  const normalized = address.toLowerCase();
  const mappedIPv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIPv4) return isBlockedIPv4Address(mappedIPv4[1]);

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff') ||
    normalized.includes('::ffff:127.') ||
    normalized.includes('::ffff:10.') ||
    normalized.includes('::ffff:192.168.')
  );
}

async function validateProxyUrl(rawUrl: string): Promise<{ url: URL; address: string }> {
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

  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Unable to resolve addon host.',
    });
  }

  const address = addresses.find(({ address }) => !isBlockedAddress(address))?.address;
  if (!address || addresses.some(({ address: candidate }) => isBlockedAddress(candidate))) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'Requests to internal or private addresses are not allowed.',
    });
  }

  return { url: parsed, address };
}

function requestPinned(url: URL, address: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        servername: url.hostname,
        rejectUnauthorized: true,
        lookup: (_hostname, _options, callback) => {
          callback(null, address, isIP(address) as 4 | 6);
        },
        headers: {
          'User-Agent': 'Framezoo/1.0 (compatible; addon-proxy)',
          Accept: 'application/json',
        },
      },
      resolve,
    );
    request.setTimeout(15_000, () => request.destroy(new Error('Addon server timed out')));
    request.on('error', reject);
  });
}

export default defineEventHandler(async event => {
  const { url } = getQuery(event);

  if (!url || typeof url !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Missing required query parameter: url',
    });
  }

  const target = await validateProxyUrl(url);

  let response: IncomingMessage;
  try {
    response = await requestPinned(target.url, target.address);
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

  if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
    response.resume();
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: `Addon server responded with status ${response.statusCode ?? 'unknown'}.`,
    });
  }

  const contentLength = response.headers['content-length'];
  if (contentLength && Number(contentLength) > MAX_RESPONSE_SIZE_BYTES) {
    response.resume();
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: 'Addon response exceeds the maximum allowed size.',
    });
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for await (const chunk of response) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_SIZE_BYTES) {
      response.destroy();
      throw createError({
        statusCode: 502,
        statusMessage: 'Bad Gateway',
        message: 'Addon response exceeds the maximum allowed size.',
      });
    }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks, totalBytes);

  // Forward content-type from the origin addon server
  const contentType = response.headers['content-type'] || 'application/json';

  setHeader(event, 'Content-Type', contentType);
  setHeader(event, 'Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  setHeader(event, 'X-Proxied-From', target.url.hostname);

  return new Response(buffer, { status: 200 });
});
