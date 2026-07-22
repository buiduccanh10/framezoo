import type { H3Event } from 'h3';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type H3EventCompat = any;

const DEFAULT_DEV_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://localhost:5174',
]);

const isLocalDevelopmentOrigin = (value: string) => {
  if (value === 'null') {
    return true;
  }

  try {
    const { hostname } = new URL(value);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
};

const normalizeOrigin = (value: string) => {
  const trimmedValue = value.trim();
  if (trimmedValue === 'null') {
    return 'null';
  }

  try {
    const parsed = new URL(trimmedValue);
    if (parsed.origin !== 'null') {
      return parsed.origin;
    }

    // Preserve origins from Electron's custom app:// scheme.
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return trimmedValue.replace(/\/+$/, '');
  }
};

const DEFAULT_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Requested-With',
  'X-Proxy-Capability',
  'Range',
  'If-Range',
  'X-Token',
];
const ALLOWED_HEADER_NAMES = new Map(
  DEFAULT_ALLOWED_HEADERS.map(header => [header.toLowerCase(), header])
);

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

export const resolveCorsOrigin = (event: H3EventCompat) => {
  const requestOrigin = getRequestHeader(event, 'origin');
  if (!requestOrigin) {
    return null;
  }

  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);

  if (allowedOrigins.has(normalizedRequestOrigin)) {
    return normalizedRequestOrigin;
  }

  // Allow local dev origins even when a frontend allowlist is present.
  if (
    process.env.NODE_ENV !== 'production' &&
    (DEFAULT_DEV_ORIGINS.has(normalizedRequestOrigin) ||
      isLocalDevelopmentOrigin(normalizedRequestOrigin))
  ) {
    return normalizedRequestOrigin;
  }

  return null;
};

export const applyCorsHeaders = (
  event: H3EventCompat,
  methods = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  headers = 'Content-Type, Authorization, X-Requested-With, X-Proxy-Capability'
) => {
  const origin = resolveCorsOrigin(event);
  if (!origin) {
    return false;
  }

  const requestedHeaders = getRequestHeader(event, 'access-control-request-headers');
  const resolvedHeaders =
    headers === '*'
      ? requestedHeaders
        ? requestedHeaders
            .split(',')
            .map(header => ALLOWED_HEADER_NAMES.get(header.trim().toLowerCase()))
            .filter((header): header is string => Boolean(header))
            .join(', ') || DEFAULT_ALLOWED_HEADERS.join(', ')
        : DEFAULT_ALLOWED_HEADERS.join(', ')
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
