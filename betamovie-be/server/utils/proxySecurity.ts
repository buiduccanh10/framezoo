import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Transform } from 'node:stream';
import type { H3Event } from 'h3';
import { createError, getQuery, getRequestHeader } from 'h3';
import {
  fetch as undiciFetch,
  interceptors,
  Pool,
  type RequestInit as UndiciRequestInit,
} from 'undici';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { useAuth } from '~/utils/auth';

export type ProxyCapabilityKind =
  | 'm3u8'
  | 'media'
  | 'preview'
  | 'preview-auto'
  | 'preview-file'
  | 'embed'
  | 'vixsrc';

export type ProxyCapabilityPayload = JwtPayload & {
  typ: 'proxy-capability';
  kind: ProxyCapabilityKind;
  requestHash: string;
  resourceHash?: string;
};

type ProxyAccessOptions = {
  kind: ProxyCapabilityKind;
  targetUrl?: string;
  headers?: Record<string, string>;
  resource?: string;
};

const PROXY_CAPABILITY_AUDIENCE = 'betamovie-proxy';
const DEFAULT_PROXY_CAPABILITY_TTL_SECONDS = 60 * 60;
const DEFAULT_PROXY_UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_PROXY_HEADER_COUNT = 16;
const MAX_PROXY_HEADER_VALUE_LENGTH = 2048;
const MAX_PROXY_CAPABILITY_LENGTH = 16_384;
const SAFE_PROXY_HEADERS = new Set([
  'accept',
  'accept-language',
  'origin',
  'referer',
  'user-agent',
]);

const getPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const getProxyCapabilityTtlSeconds = () =>
  getPositiveInt(process.env.PROXY_CAPABILITY_TTL_SECONDS, DEFAULT_PROXY_CAPABILITY_TTL_SECONDS);

export const getProxyUpstreamTimeoutMs = () =>
  getPositiveInt(process.env.PROXY_UPSTREAM_TIMEOUT_MS, DEFAULT_PROXY_UPSTREAM_TIMEOUT_MS);

const getCryptoSecret = () => {
  const secret = (process.env.CRYPTO_SECRET || '').trim();
  if (!secret) {
    throw new Error('CRYPTO_SECRET environment variable is not set');
  }
  return secret;
};

const normalizeTargetUrl = (targetUrl: string) => {
  const parsed = new URL(targetUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP(S) upstream URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Upstream URL credentials are not allowed');
  }
  return parsed.toString();
};

const stableHeaders = (headers: Record<string, string> = {}) => {
  const normalized = normalizeProxyHeaders(headers);
  return Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b)));
};

export const normalizeProxyHeaders = (headers: Record<string, string> = {}) => {
  const normalized: Record<string, string> = {};

  for (const [rawName, rawValue] of Object.entries(headers)) {
    if (Object.keys(normalized).length >= MAX_PROXY_HEADER_COUNT) break;

    const name = rawName.trim().toLowerCase();
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!SAFE_PROXY_HEADERS.has(name) || !value) continue;
    if (value.length > MAX_PROXY_HEADER_VALUE_LENGTH) continue;

    normalized[name] = value;
  }

  return normalized;
};

const hashRequest = (
  kind: ProxyCapabilityKind,
  targetUrl = '',
  headers: Record<string, string> = {},
  resource = ''
) => {
  const normalizedTarget = targetUrl ? normalizeTargetUrl(targetUrl) : '';
  const input = JSON.stringify({
    kind,
    targetUrl: normalizedTarget,
    headers: stableHeaders(headers),
    resource,
  });

  return createHash('sha256').update(input).digest('hex');
};

export const issueProxyCapability = (
  kind: ProxyCapabilityKind,
  targetUrl = '',
  headers: Record<string, string> = {},
  resource = '',
  ttlSeconds = getProxyCapabilityTtlSeconds()
) => {
  const normalizedTarget = targetUrl ? normalizeTargetUrl(targetUrl) : '';
  const payload: Omit<ProxyCapabilityPayload, 'iat' | 'exp' | 'aud'> = {
    typ: 'proxy-capability',
    kind,
    requestHash: hashRequest(kind, normalizedTarget, headers, resource),
  };

  if (resource) {
    payload.resourceHash = createHash('sha256').update(resource).digest('hex');
  }

  return jwt.sign(payload, getCryptoSecret(), {
    algorithm: 'HS256',
    audience: PROXY_CAPABILITY_AUDIENCE,
    expiresIn: Math.max(1, Math.min(ttlSeconds, 60 * 60)),
  });
};

export const verifyProxyCapabilityToken = (
  token: string,
  kind: ProxyCapabilityKind
): ProxyCapabilityPayload | null => {
  try {
    const payload = jwt.verify(token, getCryptoSecret(), {
      algorithms: ['HS256'],
      audience: PROXY_CAPABILITY_AUDIENCE,
    });

    if (typeof payload === 'string') return null;
    const typed = payload as ProxyCapabilityPayload;
    if (typed.typ !== 'proxy-capability' || typed.kind !== kind) return null;
    if (!typed.requestHash) return null;
    return typed;
  } catch {
    return null;
  }
};

export const assertProxyCapability = (token: string, options: ProxyAccessOptions) => {
  const payload = verifyProxyCapabilityToken(token, options.kind);
  if (!payload) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid or expired proxy capability',
    });
  }

  const expectedHash = hashRequest(
    options.kind,
    options.targetUrl || '',
    options.headers || {},
    options.resource || ''
  );

  if (payload.requestHash !== expectedHash) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Proxy capability does not match the requested resource',
    });
  }

  return payload;
};

export const getProxyCapabilityToken = (event: H3Event) => {
  const query = getQuery(event);
  const token = query.capability;
  if (
    typeof token === 'string' &&
    token.trim().length > 0 &&
    token.trim().length <= MAX_PROXY_CAPABILITY_LENGTH
  ) {
    return token.trim();
  }

  const headerToken = getRequestHeader(event, 'x-proxy-capability');
  return headerToken && headerToken.trim().length <= MAX_PROXY_CAPABILITY_LENGTH
    ? headerToken.trim()
    : '';
};

export const getProxyCapabilityKindForPath = (path: string): ProxyCapabilityKind | null => {
  const normalizedPath = (path.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  if (normalizedPath === '/api/m3u8-proxy' || normalizedPath === '/api/embed/api/m3u8-proxy') {
    return 'm3u8';
  }
  if (normalizedPath === '/api/media-proxy' || normalizedPath === '/api/embed/api/media-proxy') {
    return 'media';
  }
  if (
    normalizedPath === '/api/preview-proxy' ||
    normalizedPath === '/api/embed/api/preview-proxy'
  ) {
    return 'preview';
  }
  if (normalizedPath === '/api/preview/auto' || normalizedPath === '/api/embed/api/preview/auto') {
    return 'preview-auto';
  }
  if (normalizedPath === '/api/preview/file' || normalizedPath === '/api/embed/api/preview/file') {
    return 'preview-file';
  }
  if (normalizedPath === '/api/proxy/vixsrc' || normalizedPath.startsWith('/api/proxy/vixsrc/')) {
    return 'vixsrc';
  }
  if (
    normalizedPath === '/api/embed/ts-proxy' ||
    normalizedPath.startsWith('/api/embed/ts-proxy/') ||
    normalizedPath === '/api/embed/api/ts-proxy' ||
    normalizedPath.startsWith('/api/embed/api/ts-proxy/') ||
    normalizedPath === '/api/embed/proxy' ||
    normalizedPath.startsWith('/api/embed/proxy/') ||
    normalizedPath === '/api/embed/api/proxy' ||
    normalizedPath.startsWith('/api/embed/api/proxy/')
  ) {
    return 'embed';
  }
  return null;
};

export const isProxyCapabilityPath = (path: string) =>
  ((path.split('?')[0] || '/').replace(/\/+$/, '') || '/') === '/api/proxy/capability';

export const isValidInternalApiRequest = (event: H3Event) => {
  const expected = process.env.INTERNAL_API_TOKEN?.trim();
  if (!expected) return false;

  const headerToken = getRequestHeader(event, 'x-internal-token')?.trim();
  return headerToken === expected;
};

export const requireProxyAccess = async (event: H3Event, options: ProxyAccessOptions) => {
  const token = getProxyCapabilityToken(event);
  if (token) {
    return {
      mode: 'capability' as const,
      capability: assertProxyCapability(token, options),
    };
  }

  if (isValidInternalApiRequest(event)) {
    return {
      mode: 'internal' as const,
      capability: null,
    };
  }

  const session = event.context.session || (await useAuth().getCurrentSessionForEvent(event));
  return {
    mode: 'session' as const,
    capability: null,
    session,
  };
};

export const buildProxyRequestUrl = (
  origin: string,
  path: string,
  kind: ProxyCapabilityKind,
  targetUrl: string,
  headers: Record<string, string> = {},
  resource = '',
  ttlSeconds?: number
) => {
  const normalizedHeaders = normalizeProxyHeaders(headers);
  const capability = issueProxyCapability(kind, targetUrl, normalizedHeaders, resource, ttlSeconds);
  const params = new URLSearchParams({
    capability,
  });

  if (targetUrl) {
    params.set('url', normalizeTargetUrl(targetUrl));
  }
  if (Object.keys(normalizedHeaders).length > 0) {
    params.set('headers', JSON.stringify(normalizedHeaders));
  }
  if (resource) {
    params.set('resource', resource);
  }

  return `${origin}${path}?${params.toString()}`;
};

const isPrivateIpv4 = (address: string) => {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value))) return true;

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && b >= 18 && b <= 19) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    a >= 224
  );
};

const parseIpv6Hextets = (address: string) => {
  const normalized = address.toLowerCase().split('%')[0];
  const parts = normalized.split('::');
  if (parts.length > 2) return null;

  const expandPart = (part: string) => {
    if (!part) return [];
    const tokens = part.split(':');
    const expanded: string[] = [];
    for (const token of tokens) {
      if (token.includes('.')) {
        const octets = token.split('.').map(Number);
        if (
          octets.length !== 4 ||
          octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)
        ) {
          return null;
        }
        expanded.push(
          ((octets[0] << 8) | octets[1]).toString(16),
          ((octets[2] << 8) | octets[3]).toString(16)
        );
      } else if (/^[0-9a-f]{1,4}$/.test(token)) {
        expanded.push(token);
      } else {
        return null;
      }
    }
    return expanded;
  };

  const left = expandPart(parts[0]);
  const right = expandPart(parts[1] || '');
  if (!left || !right) return null;

  const missing = 8 - left.length - right.length;
  if (parts.length === 1 || missing < 0) {
    return left.length === 8 ? left.map(value => Number.parseInt(value, 16)) : null;
  }

  return [
    ...left.map(value => Number.parseInt(value, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map(value => Number.parseInt(value, 16)),
  ];
};

const isPrivateIpv6 = (address: string) => {
  const hextets = parseIpv6Hextets(address);
  if (!hextets || hextets.length !== 8) return true;

  const [first, second, third, fourth, fifth, sixth, seventh, eighth] = hextets;
  if (first === 0 && second === 0 && third === 0 && fourth === 0 && fifth === 0) {
    if (sixth === 0 || sixth === 0xffff) {
      return isPrivateIpv4(`${seventh >> 8}.${seventh & 0xff}.${eighth >> 8}.${eighth & 0xff}`);
    }
  }
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;

  return false;
};

const isPrivateAddress = (address: string) => {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return false;
};

const normalizeHostname = (hostname: string) =>
  hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
    .toLowerCase();


export const assertSafeUpstreamUrl = async (rawUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid upstream URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP(S) upstream URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Upstream URL credentials are not allowed');
  }
  const hostname = normalizeHostname(parsed.hostname);

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new Error('Private upstream host is not allowed');
  }

  if (
    process.env.NODE_ENV !== 'production' &&
    String(process.env.ALLOW_PRIVATE_UPSTREAMS).toLowerCase() === 'true'
  ) {
    return parsed.toString();
  }

  if (isPrivateAddress(hostname)) {
    throw new Error('Private upstream address is not allowed');
  }

  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => isPrivateAddress(record.address))) {
    throw new Error('Upstream resolves to a private address');
  }

  return parsed.toString();
};

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export const fetchWithTimeout = async (
  url: string,
  init: UndiciRequestInit & { dispatcher?: unknown } = {},
  timeoutMs = getProxyUpstreamTimeoutMs()
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const upstreamSignal = init.signal;
  const onAbort = () => controller.abort();

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  try {
    return await undiciFetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', onAbort);
  }
};

export const fetchSafeUpstream = async (
  rawUrl: string,
  init: UndiciRequestInit = {},
  maxRedirects = 3
) => {
  let currentUrl = await assertSafeUpstreamUrl(rawUrl);

  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetchWithTimeout(currentUrl, {
      ...init,
      dispatcher: getProxyPoolForUrl(currentUrl),
      redirect: 'manual',
    });

    if (!REDIRECT_STATUS_CODES.has(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    if (response.body) {
      await response.body.cancel().catch(() => null);
    }
    if (!location) {
      return response;
    }

    if (redirectCount >= maxRedirects) {
      throw createError({
        statusCode: 502,
        statusMessage: 'Upstream redirect limit exceeded',
      });
    }

    currentUrl = await assertSafeUpstreamUrl(new URL(location, currentUrl).toString());
  }
};

export const readResponseBytesLimited = async (
  body: AsyncIterable<Uint8Array | Buffer>,
  maxBytes: number
) => {
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for await (const chunk of body) {
      const buffer = Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        throw createError({
          statusCode: 413,
          statusMessage: 'Upstream response exceeds the configured size limit',
        });
      }
      chunks.push(buffer);
    }
  } catch (error) {
    const closable = body as AsyncIterable<Uint8Array | Buffer> & {
      destroy?: () => void;
    };
    closable.destroy?.();
    throw error;
  }

  return Buffer.concat(chunks);
};

type WebResponseLike = {
  headers: {
    get(name: string): string | null;
  };
  body: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<unknown>;
      releaseLock(): void;
    };
  } | null;
};

export const readWebResponseBytesLimited = async (response: WebResponseLike, maxBytes: number) => {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Upstream response exceeds the configured size limit',
    });
  }

  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;

      const buffer = Buffer.from(next.value || new Uint8Array());
      total += buffer.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw createError({
          statusCode: 413,
          statusMessage: 'Upstream response exceeds the configured size limit',
        });
      }
      chunks.push(buffer);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
};

export const limitNodeReadable = (stream: NodeJS.ReadableStream, maxBytes: number) => {
  let total = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      total += Buffer.byteLength(chunk);
      if (total > maxBytes) {
        (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
        callback(
          createError({
            statusCode: 413,
            statusMessage: 'Upstream response exceeds the configured size limit',
          })
        );
        return;
      }
      callback(null, chunk);
    },
  });

  (
    stream as NodeJS.ReadableStream & {
      pipe: (destination: Transform) => Transform;
    }
  ).pipe(limiter);

  return limiter;
};

let activeProxyRequests = 0;

const proxyPoolsByOrigin = new Map<string, Pool>();
const MAX_PROXY_POOLS = Math.max(
  8,
  Number.parseInt(process.env.PROXY_MAX_POOLS || process.env.M3U8_PROXY_MAX_POOLS || '64', 10) || 64
);
const PROXY_POOL_CONNECTIONS = Math.max(
  1,
  Number.parseInt(process.env.PROXY_POOL_CONNECTIONS || '32', 10) || 32
);
const PROXY_DNS_MAX_TTL_MS = 1000;

const allowPrivateUpstreams =
  process.env.NODE_ENV !== 'production' &&
  String(process.env.ALLOW_PRIVATE_UPSTREAMS).toLowerCase() === 'true';

const lookupSafeProxyAddresses = (origin: URL, _options: any, callback: any) => {
  lookup(origin.hostname, { all: true, verbatim: true })
    .then(records => {
      const safeRecords = allowPrivateUpstreams
        ? records
        : records.filter(record => !isPrivateAddress(record.address));

      if (!safeRecords.length) {
        callback(new Error('Upstream resolves to a private address'), []);
        return;
      }

      callback(
        null,
        safeRecords.map(record => ({
          address: record.address,
          family: record.family,
          ttl: PROXY_DNS_MAX_TTL_MS,
        }))
      );
    })
    .catch(error => callback(error, []));
};

export const getProxyPoolForUrl = (rawUrl: string) => {
  let origin: string;
  try {
    origin = new URL(rawUrl).origin;
  } catch {
    return undefined;
  }

  const cached = proxyPoolsByOrigin.get(origin);
  if (cached) return cached;

  const pool = new Pool(origin, {
    connections: PROXY_POOL_CONNECTIONS,
    pipelining: 4,
    keepAliveTimeout: 60 * 1000,
    keepAliveMaxTimeout: 10 * 60 * 1000,
  });
  proxyPoolsByOrigin.set(origin, pool);

  if (proxyPoolsByOrigin.size > MAX_PROXY_POOLS) {
    const oldestOrigin = proxyPoolsByOrigin.keys().next().value;
    if (oldestOrigin && oldestOrigin !== origin) {
      const oldestPool = proxyPoolsByOrigin.get(oldestOrigin);
      proxyPoolsByOrigin.delete(oldestOrigin);
      void oldestPool?.close().catch(() => null);
    }
  }

  return pool.compose(
    interceptors.dns({
      lookup: lookupSafeProxyAddresses,
      maxTTL: PROXY_DNS_MAX_TTL_MS,
      maxItems: MAX_PROXY_POOLS,
      dualStack: true,
    })
  );
};

export const acquireProxySlot = () => {
  const maxConcurrent = getPositiveInt(process.env.PROXY_MAX_CONCURRENT_REQUESTS, 64);

  if (activeProxyRequests >= maxConcurrent) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Proxy capacity is temporarily exhausted',
    });
  }

  activeProxyRequests += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    activeProxyRequests = Math.max(0, activeProxyRequests - 1);
  };
};

export const getProxyResponseLimit = (kind: ProxyCapabilityKind) => {
  const fallback =
    kind === 'm3u8'
      ? 16 * 1024 * 1024
      : kind === 'media'
        ? 2 * 1024 * 1024 * 1024
        : kind === 'embed' || kind === 'vixsrc'
          ? 16 * 1024 * 1024
          : 10 * 1024 * 1024;

  return getPositiveInt(
    process.env[
      kind === 'm3u8'
        ? 'M3U8_PROXY_MAX_RESPONSE_BYTES'
        : kind === 'media'
          ? 'MEDIA_PROXY_MAX_RESPONSE_BYTES'
          : kind === 'embed'
            ? 'EMBED_PROXY_MAX_RESPONSE_BYTES'
            : kind === 'vixsrc'
              ? 'VIXSRC_PROXY_MAX_RESPONSE_BYTES'
              : 'PREVIEW_PROXY_MAX_RESPONSE_BYTES'
    ],
    fallback
  );
};
