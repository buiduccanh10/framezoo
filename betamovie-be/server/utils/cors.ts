import type { H3Event } from 'h3';

const DEFAULT_DEV_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

const normalizeOrigin = (value: string) => {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, '');
  }
};

const parseAllowedOrigins = () => {
  const raw = process.env.CORS_ALLOWED_ORIGINS || process.env.FRONTEND_ORIGIN || '';
  const parsed = raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(normalizeOrigin);

  return new Set(parsed);
};

const allowedOrigins = parseAllowedOrigins();

export const resolveCorsOrigin = (event: H3Event) => {
  const requestOrigin = getRequestHeader(event, 'origin');
  if (!requestOrigin) {
    return null;
  }

  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);

  if (allowedOrigins.has(normalizedRequestOrigin)) {
    return normalizedRequestOrigin;
  }

  // Safe local fallback for developer setups where NODE_ENV is production-like
  // but no explicit CORS allowlist is configured.
  if (allowedOrigins.size === 0 && DEFAULT_DEV_ORIGINS.has(normalizedRequestOrigin)) {
    return normalizedRequestOrigin;
  }

  return null;
};

export const applyCorsHeaders = (
  event: H3Event,
  methods = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  headers = 'Content-Type, Authorization, X-Requested-With'
) => {
  const origin = resolveCorsOrigin(event);
  if (!origin) {
    return false;
  }

  const requestedHeaders = getRequestHeader(event, 'access-control-request-headers');
  const resolvedHeaders =
    headers === '*'
      ? requestedHeaders && requestedHeaders.trim().length > 0
        ? requestedHeaders
        : 'Content-Type, Authorization, X-Requested-With'
      : headers;

  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': resolvedHeaders,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });

  return true;
};
