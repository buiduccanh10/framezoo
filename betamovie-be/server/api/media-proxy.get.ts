import { Readable } from 'node:stream';
import { sendStream, setResponseStatus } from 'h3';
import { applyCorsHeaders } from '~/utils/cors';

const MODERN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const PASSTHROUGH_REQUEST_HEADERS = ['range', 'if-range', 'if-none-match', 'if-modified-since'];
const PASSTHROUGH_RESPONSE_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'expires',
  'last-modified',
];

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

const readHeaderCaseInsensitive = (headers: Record<string, string>, name: string) => {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return '';
};

const setCorsHeaders = (event: any) => {
  applyCorsHeaders(event, 'GET, OPTIONS, HEAD', '*');
};

export default defineEventHandler(async event => {
  if (event.method === 'OPTIONS') {
    setCorsHeaders(event);
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
  const targetUrl = typeof query.url === 'string' ? query.url.trim() : '';

  if (!targetUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'URL parameter is required',
    });
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = new URL(targetUrl).toString();
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid URL parameter',
    });
  }

  const proxyHeaders = parseProxyHeaders(query.headers);
  const requestHeaders: Record<string, string> = {
    Accept: getRequestHeader(event, 'accept') || '*/*',
    'Accept-Encoding': 'identity',
    'User-Agent':
      readHeaderCaseInsensitive(proxyHeaders, 'user-agent') ||
      getRequestHeader(event, 'user-agent') ||
      MODERN_UA,
  };

  for (const [key, value] of Object.entries(proxyHeaders)) {
    requestHeaders[key] = value;
  }

  for (const headerName of PASSTHROUGH_REQUEST_HEADERS) {
    const value = getRequestHeader(event, headerName);
    if (value) {
      requestHeaders[headerName] = value;
    }
  }

  const response = await fetch(normalizedUrl, {
    method: event.method,
    headers: requestHeaders,
    redirect: 'follow',
  }).catch(error => {
    throw createError({
      statusCode: 502,
      statusMessage: `Failed to proxy media: ${error?.message || String(error)}`,
    });
  });

  setResponseStatus(event, response.status, response.statusText);
  setCorsHeaders(event);

  for (const headerName of PASSTHROUGH_RESPONSE_HEADERS) {
    const value = response.headers.get(headerName);
    if (value) {
      setHeader(event, headerName, value);
    }
  }

  if (!response.headers.get('content-type')) {
    setHeader(event, 'content-type', 'application/octet-stream');
  }

  if (event.method === 'HEAD' || !response.body) {
    return null;
  }

  return sendStream(event, Readable.fromWeb(response.body as any));
});
