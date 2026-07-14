import { createHash } from 'node:crypto';
import { sendStream } from 'h3';
import { request } from 'undici';
import { applyCorsHeaders } from '~/utils/cors';
import {
  acquireProxySlot,
  assertSafeUpstreamUrl,
  buildProxyRequestUrl,
  getProxyResponseLimit,
  getProxyPoolForUrl,
  limitNodeReadable,
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
        if (typeof value === 'string') acc[key] = value;
        return acc;
      },
      {}
    );
  } catch {
    return {};
  }
};

const logInfo = (message: string, ...args: any[]) => {
  console.log(`[m3u8-proxy] ${message}`, ...args);
};

const logWarn = (message: string, ...args: any[]) => {
  console.warn(`[m3u8-proxy] ${message}`, ...args);
};

const safeUrlForLog = (value: string) => {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '[invalid-url]';
  }
};

const hashKey = (input: string) => createHash('sha256').update(input).digest('hex');
const SEGMENT_RETRY_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.M3U8_SEGMENT_RETRY_ATTEMPTS || '2', 10) || 2
);
const SEGMENT_SKIP_FALLBACK_ENABLED =
  String(process.env.M3U8_SEGMENT_SKIP_FALLBACK_ENABLED || 'true').toLowerCase() !== 'false';
const SEGMENT_SKIP_MIN_BYTES = Math.max(
  1,
  Number.parseInt(process.env.M3U8_SEGMENT_SKIP_MIN_BYTES || '25000', 10) || 25000
);
const SEGMENT_SKIP_MAX_ADVANCE = Math.max(
  1,
  Number.parseInt(process.env.M3U8_SEGMENT_SKIP_MAX_ADVANCE || '4', 10) || 4
);
const SEGMENT_SKIP_PREFERRED_ADVANCE = Math.min(
  SEGMENT_SKIP_MAX_ADVANCE,
  Math.max(1, Number.parseInt(process.env.M3U8_SEGMENT_SKIP_PREFERRED_ADVANCE || '1', 10) || 1)
);
const SEGMENT_SKIP_REFERER_HOSTS = (process.env.M3U8_SEGMENT_SKIP_REFERER_HOSTS || '111movies.net')
  .split(',')
  .map(value => value.trim().toLowerCase())
  .filter(Boolean);
const SEGMENT_SKIP_STICKY_SECONDS = Math.max(
  15,
  Number.parseInt(process.env.M3U8_SEGMENT_SKIP_STICKY_SECONDS || '900', 10) || 900
);
const SEGMENT_SKIP_MAX_GAP_SECONDS = Math.max(
  0.5,
  Number.parseFloat(process.env.M3U8_SEGMENT_SKIP_MAX_GAP_SECONDS || '2.2') || 2.2
);
const SEGMENT_SKIP_MAX_OVERLAP_SECONDS = Math.max(
  0.1,
  Number.parseFloat(process.env.M3U8_SEGMENT_SKIP_MAX_OVERLAP_SECONDS || '0.9') || 0.9
);
const SEGMENT_SKIP_MAX_TOTAL_OFFSET = Math.max(
  1,
  Number.parseInt(process.env.M3U8_SEGMENT_SKIP_MAX_TOTAL_OFFSET || '24', 10) || 24
);
const SEGMENT_MIN_VALID_PTS_SPAN_SECONDS = Math.max(
  0.2,
  Number.parseFloat(process.env.M3U8_SEGMENT_MIN_VALID_PTS_SPAN_SECONDS || '1.0') || 1.0
);
const SEGMENT_QUALITY_STICKY_SECONDS = Math.max(
  60,
  Number.parseInt(process.env.M3U8_SEGMENT_QUALITY_STICKY_SECONDS || '1800', 10) || 1800
);
const DEFAULT_SEGMENT_BODY_TIMEOUT_MS = Math.max(
  0,
  Number.parseInt(process.env.M3U8_SEGMENT_BODY_TIMEOUT_MS || '15000', 10) || 15000
);
const M3U8_1080_PATH_TOKEN = '/MTA4MA==/';
const M3U8_720_PATH_TOKEN = '/NzIw/';
const SEGMENT_CACHE_KEY_VERSION = 'v4';
const SEGMENT_PATH_HINT_RE = /\.(?:ts|m4s|m4v|mp4|aac|vtt)(?:$|[?#])/i;
const VIDEASY_PASSTHROUGH_REFERER_HOSTS = ['player.videasy.to', 'player.videasy.net'] as const;
const VIDEASY_PASSTHROUGH_UPSTREAM_HOSTS = ['ironwallnet.net'] as const;

const isSuccessfulSegmentStatus = (statusCode: number) => statusCode === 200 || statusCode === 206;

interface SegmentSkipStickyState {
  offset: number;
  stickyUntil: number;
  setAt: number;
  lastEndPts: number | null;
}

interface SegmentQualityStickyState {
  quality: '720';
  stickyUntil: number;
  setAt: number;
  lastEndPts: number | null;
}

interface PtsRange {
  min: number;
  max: number;
}

const shouldRetryStatus = (statusCode: number) => statusCode === 429 || statusCode >= 500;

const normalizeHostname = (value: string) => value.trim().toLowerCase().replace(/\.+$/, '');

const readUrlHostname = (value: string) => {
  if (!value) return '';
  try {
    return normalizeHostname(new URL(value).hostname);
  } catch {
    return '';
  }
};

const hostnameMatches = (hostname: string, allowedHosts: readonly string[]) => {
  if (!hostname) return false;
  return allowedHosts.some(allowedHost => {
    const normalizedAllowedHost = normalizeHostname(allowedHost);
    return hostname === normalizedAllowedHost || hostname.endsWith(`.${normalizedAllowedHost}`);
  });
};

const readHeaderCaseInsensitive = (headers: Record<string, string>, key: string) => {
  const target = key.toLowerCase();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === target) {
      return value;
    }
  }
  return '';
};

const isLikelyTsPayload = (bytes: Buffer) =>
  bytes.length >= 188 * 3 && bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47;
const PTS_CLOCK = 90_000;
const SEGMENT_SKIP_MAX_GAP_PTS = Math.floor(SEGMENT_SKIP_MAX_GAP_SECONDS * PTS_CLOCK);
const SEGMENT_SKIP_MAX_OVERLAP_PTS = Math.floor(SEGMENT_SKIP_MAX_OVERLAP_SECONDS * PTS_CLOCK);
const SEGMENT_MIN_VALID_PTS_SPAN = Math.floor(SEGMENT_MIN_VALID_PTS_SPAN_SECONDS * PTS_CLOCK);

const isPtsContinuityAcceptable = (anchorPts: number | null, candidate: PtsRange | null) => {
  if (anchorPts == null || candidate?.min == null) {
    return true;
  }
  const deltaFromAnchor = candidate.min - anchorPts;
  if (deltaFromAnchor > SEGMENT_SKIP_MAX_GAP_PTS) {
    return false;
  }
  if (deltaFromAnchor < -SEGMENT_SKIP_MAX_OVERLAP_PTS) {
    return false;
  }
  return true;
};

const isWeakSegmentPayload = (bytes: Buffer, pts: PtsRange | null) =>
  bytes.length <= SEGMENT_SKIP_MIN_BYTES || !pts || pts.max - pts.min < SEGMENT_MIN_VALID_PTS_SPAN;

const extractPtsRange = (bytes: Buffer): PtsRange | null => {
  const packetSize = 188;
  const packetCount = Math.floor(bytes.length / packetSize);
  if (!packetCount) {
    return null;
  }

  let minPts = Number.POSITIVE_INFINITY;
  let maxPts = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < packetCount; index += 1) {
    const offset = index * packetSize;
    if (bytes[offset] !== 0x47) continue;

    const b1 = bytes[offset + 1];
    const b3 = bytes[offset + 3];
    const payloadUnitStart = (b1 & 0x40) !== 0;
    if (!payloadUnitStart) continue;

    const adaptationFieldControl = (b3 >> 4) & 0x3;
    if (adaptationFieldControl === 0 || adaptationFieldControl === 2) {
      continue;
    }

    let payloadOffset = offset + 4;
    if (adaptationFieldControl === 3) {
      const adaptationLength = bytes[payloadOffset] || 0;
      payloadOffset += 1 + adaptationLength;
    }

    if (payloadOffset + 14 >= offset + packetSize) {
      continue;
    }
    if (
      bytes[payloadOffset] !== 0x00 ||
      bytes[payloadOffset + 1] !== 0x00 ||
      bytes[payloadOffset + 2] !== 0x01
    ) {
      continue;
    }

    const streamId = bytes[payloadOffset + 3];
    if ((streamId & 0xf0) !== 0xe0) continue;
    const flags2 = bytes[payloadOffset + 7];
    if ((flags2 & 0x80) === 0) continue;

    const p0 = bytes[payloadOffset + 9];
    const p1 = bytes[payloadOffset + 10];
    const p2 = bytes[payloadOffset + 11];
    const p3 = bytes[payloadOffset + 12];
    const p4 = bytes[payloadOffset + 13];
    const pts =
      (p0 & 0x0e) * 536_870_912 + (p1 << 22) + ((p2 & 0xfe) << 14) + (p3 << 7) + ((p4 & 0xfe) >> 1);

    if (pts < minPts) minPts = pts;
    if (pts > maxPts) maxPts = pts;
  }

  if (!Number.isFinite(minPts) || !Number.isFinite(maxPts)) {
    return null;
  }

  return { min: minPts, max: maxPts };
};

const encodeBase64Like = (value: string, source: string) => {
  const base64 = Buffer.from(value, 'utf8').toString('base64');
  if (!source.includes('-') && !source.includes('_')) {
    return base64;
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const tryDecodeBase64Like = (value: string): string | null => {
  const variants = [value];
  if (value.includes('-') || value.includes('_')) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    variants.push(`${normalized}${pad}`);
  }

  for (const variant of variants) {
    try {
      const decoded = Buffer.from(variant, 'base64').toString('utf8');
      if (decoded) {
        return decoded;
      }
    } catch {
      // Ignore decode failures.
    }
  }

  return null;
};

const SEGMENT_NUMBER_RE = /seg-(\d+)-/i;

const buildAdvancedSegmentUrl = (rawUrl: string, advanceBy: number): string | null => {
  const direct = rawUrl.replace(SEGMENT_NUMBER_RE, (_match, numRaw) => {
    const num = Number.parseInt(numRaw, 10);
    if (!Number.isFinite(num)) {
      return _match;
    }
    return `seg-${num + advanceBy}-`;
  });
  if (direct !== rawUrl) {
    return direct;
  }

  try {
    const parsed = new URL(rawUrl);
    const parts = parsed.pathname.split('/');
    if (!parts.length) {
      return null;
    }

    const lastIndex = parts.length - 1;
    const encoded = parts[lastIndex];
    if (!encoded) {
      return null;
    }

    const decoded = tryDecodeBase64Like(encoded);
    if (!decoded || !SEGMENT_NUMBER_RE.test(decoded)) {
      return null;
    }

    const bumpedDecoded = decoded.replace(SEGMENT_NUMBER_RE, (_match, numRaw) => {
      const num = Number.parseInt(numRaw, 10);
      if (!Number.isFinite(num)) {
        return _match;
      }
      return `seg-${num + advanceBy}-`;
    });
    if (bumpedDecoded === decoded) {
      return null;
    }

    parts[lastIndex] = encodeBase64Like(bumpedDecoded, encoded);
    parsed.pathname = parts.join('/');
    return parsed.toString();
  } catch {
    return null;
  }
};

const replaceSegmentQualityToken = (
  rawUrl: string,
  fromToken: string,
  toToken: string
): string | null => {
  if (!rawUrl.includes(fromToken)) {
    return null;
  }
  const replaced = rawUrl.replace(fromToken, toToken);
  return replaced === rawUrl ? null : replaced;
};

const extractSegmentNumber = (rawUrl: string): number | null => {
  const directMatch = rawUrl.match(SEGMENT_NUMBER_RE);
  if (directMatch?.[1]) {
    const direct = Number.parseInt(directMatch[1], 10);
    return Number.isFinite(direct) ? direct : null;
  }

  try {
    const parsed = new URL(rawUrl);
    const parts = parsed.pathname.split('/');
    const encoded = parts[parts.length - 1];
    if (!encoded) {
      return null;
    }
    const decoded = tryDecodeBase64Like(encoded);
    const match = decoded?.match(SEGMENT_NUMBER_RE);
    if (!match?.[1]) {
      return null;
    }
    const value = Number.parseInt(match[1], 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
};

const isLikelySegmentRequest = (rawUrl: string, segmentNumber: number | null) => {
  if (segmentNumber != null) {
    return true;
  }

  try {
    const parsed = new URL(rawUrl);
    if (SEGMENT_PATH_HINT_RE.test(parsed.pathname)) {
      return true;
    }
  } catch {
    // Fall back to raw URL matching.
  }

  return SEGMENT_PATH_HINT_RE.test(rawUrl);
};

const buildSegmentSkipStickyIdentity = (rawUrl: string, headers: Record<string, string>) => {
  try {
    const parsed = new URL(rawUrl);
    const parts = parsed.pathname.split('/');
    if (!parts.length) {
      return '';
    }

    // Stickiness is scoped per segment sequence (same stream/quality path).
    parts[parts.length - 1] = '__segment__';
    const identity = new URLSearchParams();
    identity.set('srcHost', parsed.host);
    identity.set('scopePath', parts.join('/'));

    const stableSrcQuery = normalizeStableSearch(parsed.searchParams);
    if (stableSrcQuery) {
      identity.set('srcQuery', stableSrcQuery);
    }

    const referer = readHeaderCaseInsensitive(headers, 'referer');
    if (referer) {
      try {
        const parsedReferer = new URL(referer);
        identity.set('refHost', parsedReferer.host);
        identity.set('refPath', parsedReferer.pathname);
      } catch {
        identity.set('ref', referer);
      }
    }

    return identity.toString();
  } catch {
    return '';
  }
};

const shouldTrySegmentSkipFallback = (headers: Record<string, string>, bytes: Buffer) => {
  if (!SEGMENT_SKIP_FALLBACK_ENABLED) {
    return false;
  }
  if (bytes.length > SEGMENT_SKIP_MIN_BYTES) {
    return false;
  }
  const isTinyPayload = bytes.length <= 1024;
  if (!isLikelyTsPayload(bytes) && !isTinyPayload) {
    return false;
  }

  const referer = readHeaderCaseInsensitive(headers, 'referer');
  if (!referer || !SEGMENT_SKIP_REFERER_HOSTS.length) {
    return false;
  }

  const normalizedReferer = referer.toLowerCase();
  return SEGMENT_SKIP_REFERER_HOSTS.some(host => normalizedReferer.includes(host));
};

const requestSegmentWithRetry = async (
  url: string,
  headers: Record<string, string>,
  rangeHeader?: string,
  bodyTimeoutMs: number = DEFAULT_SEGMENT_BODY_TIMEOUT_MS
) => {
  const pool = getProxyPoolForUrl(url);
  let response: Awaited<ReturnType<typeof request>> | null = null;
  const requestHeaders = rangeHeader ? { ...headers, Range: rangeHeader } : headers;

  for (let attempt = 1; attempt <= SEGMENT_RETRY_ATTEMPTS; attempt += 1) {
    try {
      response = await request(url, {
        method: 'GET',
        headers: requestHeaders,
        dispatcher: pool,
        bodyTimeout: bodyTimeoutMs,
        headersTimeout: 5000,
      });
    } catch (error) {
      if (attempt < SEGMENT_RETRY_ATTEMPTS) {
        logWarn(`Segment request attempt ${attempt} failed, retrying: ${safeUrlForLog(url)}`);
        continue;
      }
      throw error;
    }

    if (isSuccessfulSegmentStatus(response.statusCode)) {
      return response;
    }

    if (attempt < SEGMENT_RETRY_ATTEMPTS && shouldRetryStatus(response.statusCode)) {
      await response.body.dump().catch(() => null);
      logWarn(
        `Segment status ${response.statusCode} on attempt ${attempt}, retrying: ${safeUrlForLog(url)}`
      );
      continue;
    }
    return response;
  }

  return response;
};

const shouldPassthroughSegmentStream = (
  targetUrl: string,
  headers: Record<string, string>,
  isSegmentRequest: boolean
) => {
  if (!isSegmentRequest) {
    return false;
  }

  const refererHost = readUrlHostname(readHeaderCaseInsensitive(headers, 'referer'));
  const originHost = readUrlHostname(readHeaderCaseInsensitive(headers, 'origin'));
  const upstreamHost = readUrlHostname(targetUrl);

  return (
    hostnameMatches(refererHost, VIDEASY_PASSTHROUGH_REFERER_HOSTS) ||
    hostnameMatches(originHost, VIDEASY_PASSTHROUGH_REFERER_HOSTS) ||
    hostnameMatches(upstreamHost, VIDEASY_PASSTHROUGH_UPSTREAM_HOSTS)
  );
};

const setHeaderFromUpstream = (
  event: any,
  upstreamHeaders: Record<string, string | string[] | undefined>,
  headerName: string
) => {
  const value = upstreamHeaders[headerName];
  const normalizedValue = Array.isArray(value) ? value[0] : value;
  if (normalizedValue) {
    setHeader(event, headerName, normalizedValue);
  }
};

const readResponseBytes = async (
  response: Awaited<ReturnType<typeof request>>,
  url: string,
  label: string,
  warn = true
) => {
  try {
    return await readResponseBytesLimited(response.body, getProxyResponseLimit('m3u8'));
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 413) {
      throw error;
    }
    if (warn) {
      logWarn(`Failed to read ${label} response body: ${safeUrlForLog(url)}`, error);
    }
    return null;
  }
};

const buildAdvanceOrder = (): number[] => {
  const order: number[] = [];
  const seen = new Set<number>();

  const push = (value: number) => {
    if (value < 1 || value > SEGMENT_SKIP_MAX_ADVANCE || seen.has(value)) {
      return;
    }
    seen.add(value);
    order.push(value);
  };

  // Prefer +2, then +1, then larger jumps if needed.
  push(SEGMENT_SKIP_PREFERRED_ADVANCE);
  for (let distance = 1; distance <= SEGMENT_SKIP_MAX_ADVANCE; distance += 1) {
    push(SEGMENT_SKIP_PREFERRED_ADVANCE - distance);
    push(SEGMENT_SKIP_PREFERRED_ADVANCE + distance);
  }

  return order;
};

const normalizeStableSearch = (searchParams: URLSearchParams) => {
  const volatileKeys = new Set([
    'token',
    'expires',
    'exp',
    'signature',
    'sig',
    'x-signature',
    'x-amz-signature',
    'x-amz-date',
    'x-amz-expires',
    'hmac',
    'auth',
    'ts',
    'timestamp',
  ]);

  const stable = new URLSearchParams();
  const keys = [...new Set(Array.from(searchParams.keys()))].sort();
  for (const key of keys) {
    if (volatileKeys.has(key.toLowerCase())) continue;
    const values = searchParams.getAll(key).map(String).sort();
    for (const value of values) {
      stable.append(key, value);
    }
  }
  return stable.toString();
};

const toTsProxyIdentity = (url: string, headers: Record<string, string>) => {
  const referer = headers['referer'] || headers['Referer'] || '';
  const identity = new URLSearchParams();

  if (url) {
    try {
      const parsed = new URL(url);
      identity.set('srcHost', parsed.host);
      identity.set('srcPath', parsed.pathname);
      const stableSrcQuery = normalizeStableSearch(parsed.searchParams);
      if (stableSrcQuery) {
        identity.set('srcQuery', stableSrcQuery);
      }
    } catch {
      identity.set('srcRaw', url);
    }
  }

  if (referer) {
    try {
      const parsedReferer = new URL(referer);
      const stableRefQuery = normalizeStableSearch(parsedReferer.searchParams);
      identity.set('refPath', parsedReferer.pathname);
      if (stableRefQuery) {
        identity.set('refQuery', stableRefQuery);
      }
    } catch {
      identity.set('ref', referer);
    }
  }

  return identity.toString();
};

const isProbablyM3U8 = (contentType: string | null, bodyStart: string) => {
  const ct = (contentType || '').toLowerCase();
  const hasM3u8Header =
    ct.includes('application/vnd.apple.mpegurl') ||
    ct.includes('application/x-mpegurl') ||
    ct.includes('audio/mpegurl') ||
    ct.includes('vnd.apple.mpegurl');

  const cleanStart = bodyStart.replace(/^\ufeff/, '').trimStart();
  return cleanStart.startsWith('#EXTM3U') || (hasM3u8Header && cleanStart.startsWith('#'));
};

const buildProxyUrl = (
  origin: string,
  proxyPath: string,
  targetUrl: string,
  headers: Record<string, string>,
  isSegment?: boolean
) => {
  const proxyUrl = buildProxyRequestUrl(origin, proxyPath, 'm3u8', targetUrl, headers);
  return isSegment ? `${proxyUrl}&isSegment=true` : proxyUrl;
};

const isKkPhimPlaylist = (playlistUrl: string, headers: Record<string, string>) => {
  const referer = readHeaderCaseInsensitive(headers, 'referer').toLowerCase();

  try {
    const parsed = new URL(playlistUrl);
    if (/kkphimplayer\d*\.com$/i.test(parsed.hostname)) {
      return true;
    }
  } catch {
    // Ignore parse failures and fall back to referer matching.
  }

  return referer.includes('phimapi.com');
};

const isKkPhimVideoAdSegmentUrl = (segmentUrl: string) =>
  /(?:^|\/)v\d+\/[0-9a-f]{16,}\/segment_\d+\.ts(?:$|[?#])/i.test(segmentUrl);

const stripKkPhimAdSegments = (
  manifest: string,
  playlistUrl: string,
  headers: Record<string, string>
) => {
  if (!isKkPhimPlaylist(playlistUrl, headers)) {
    return manifest;
  }

  const lines = manifest.split(/\r?\n/);
  const filtered: string[] = [];
  let removedSegments = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      filtered.push(line);
      continue;
    }

    if (trimmed.startsWith('#EXTINF:')) {
      const nextLine = lines[index + 1] ?? '';
      const nextTrimmed = nextLine.trim();

      if (nextTrimmed && !nextTrimmed.startsWith('#')) {
        let resolvedSegmentUrl = nextTrimmed;
        try {
          resolvedSegmentUrl = new URL(nextTrimmed, playlistUrl).toString();
        } catch {
          // Keep raw value for regex matching.
        }

        // `convertv*` segments are still the main episode video with a baked-in banner,
        // so stripping them would remove story content and cause a visible jump.
        if (isKkPhimVideoAdSegmentUrl(resolvedSegmentUrl)) {
          while (
            filtered.length > 0 &&
            filtered[filtered.length - 1].trim() === '#EXT-X-DISCONTINUITY'
          ) {
            filtered.pop();
          }

          removedSegments += 1;
          index += 1;

          while (index + 1 < lines.length && lines[index + 1].trim() === '#EXT-X-DISCONTINUITY') {
            index += 1;
          }

          continue;
        }
      }
    }

    filtered.push(line);
  }

  if (!removedSegments) {
    return manifest;
  }

  const normalized: string[] = [];
  for (const line of filtered) {
    const trimmed = line.trim();
    if (
      trimmed === '#EXT-X-DISCONTINUITY' &&
      (normalized.length === 0 ||
        normalized[normalized.length - 1].trim() === '#EXT-X-DISCONTINUITY')
    ) {
      continue;
    }

    normalized.push(line);
  }

  while (normalized.length > 0 && normalized[0].trim() === '#EXT-X-DISCONTINUITY') {
    normalized.shift();
  }

  while (
    normalized.length > 0 &&
    normalized[normalized.length - 1].trim() === '#EXT-X-DISCONTINUITY'
  ) {
    normalized.pop();
  }

  logInfo(
    `Stripped ${removedSegments} KKPhim video-ad segment(s) from playlist: ${safeUrlForLog(
      playlistUrl
    )}`
  );
  return normalized.join('\n');
};

const rewriteM3U8 = (
  manifest: string,
  playlistUrl: string,
  origin: string,
  proxyPath: string,
  headers: Record<string, string>
) => {
  const lines = stripKkPhimAdSegments(manifest, playlistUrl, headers).split(/\r?\n/);
  const rewritten = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    // Rewrite URI="..." attributes (audio/subs keys, etc.)
    if (trimmed.startsWith('#')) {
      return line.replace(/URI=\"([^\"]+)\"/g, (_m, uri) => {
        try {
          const abs = new URL(uri, playlistUrl).toString();
          const isPlaylist = /\.m3u8(?:$|[?#])/i.test(abs) || abs.includes('type=hls');
          const proxied = buildProxyUrl(origin, proxyPath, abs, headers, !isPlaylist);
          return `URI=\"${proxied}\"`;
        } catch {
          return `URI=\"${uri}\"`;
        }
      });
    }

    // Bare URL line (variant playlist or segment)
    try {
      const abs = new URL(trimmed, playlistUrl).toString();
      const isPlaylist = /\.m3u8(?:$|[?#])/i.test(abs) || abs.includes('type=hls');
      return buildProxyUrl(origin, proxyPath, abs, headers, !isPlaylist);
    } catch {
      return line;
    }
  });
  return rewritten.join('\n');
};

/**
 * Set CORS and cache headers for optimal CDN caching
 */
const setCacheHeaders = (event: any, isSegment: boolean = false) => {
  applyCorsHeaders(event, 'GET, OPTIONS, HEAD', '*');

  // CDN cache control
  if (isSegment) {
    // Segments can be cached for longer at CDN
    setHeader(event, 'cache-control', 'public, max-age=600, s-maxage=1800');
  } else {
    // Playlists need shorter cache
    setHeader(event, 'cache-control', 'public, max-age=60, s-maxage=300');
  }
};

export default defineEventHandler(async event => {
  const startTime = Date.now();

  // Handle OPTIONS for CORS
  if (event.method === 'OPTIONS') {
    setCacheHeaders(event);
    return null;
  }

  const query = getQuery(event);
  const url = typeof query.url === 'string' ? query.url : '';
  if (!url) {
    throw createError({ statusCode: 400, statusMessage: 'Missing url' });
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = await assertSafeUpstreamUrl(url);
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unsafe upstream URL',
    });
  }

  const headers = normalizeProxyHeaders(parseProxyHeaders(query.headers));
  await requireProxyAccess(event, {
    kind: 'm3u8',
    targetUrl: normalizedUrl,
    headers,
  });

  const isGetRequest = event.method === 'GET';
  const segmentNumber = extractSegmentNumber(normalizedUrl);
  const isSegmentRequest =
    query.isSegment === 'true' || isLikelySegmentRequest(normalizedUrl, segmentNumber);
  const requestedRange = isSegmentRequest ? getRequestHeader(event, 'range') || '' : '';
  const storage = isGetRequest && isSegmentRequest && !requestedRange ? useStorage('cache') : null;
  const stickyIdentity =
    segmentNumber != null && storage ? buildSegmentSkipStickyIdentity(normalizedUrl, headers) : '';
  const stickyKey =
    stickyIdentity && storage ? `m3u8-proxy:segment-skip:sticky:v1:${hashKey(stickyIdentity)}` : '';
  const stickyState = stickyKey
    ? await storage.getItem<SegmentSkipStickyState>(stickyKey).catch(() => null)
    : null;
  const qualityStickyKey =
    stickyIdentity && storage
      ? `m3u8-proxy:segment-quality:sticky:v1:${hashKey(stickyIdentity)}`
      : '';
  const qualityStickyState = qualityStickyKey
    ? await storage.getItem<SegmentQualityStickyState>(qualityStickyKey).catch(() => null)
    : null;
  const now = Date.now();
  const stickyExpired = Boolean(stickyState?.stickyUntil && stickyState.stickyUntil <= now);
  const qualityStickyExpired = Boolean(
    qualityStickyState?.stickyUntil && qualityStickyState.stickyUntil <= now
  );
  if (stickyExpired && stickyKey && storage) {
    void storage.removeItem(stickyKey).catch(() => null);
  }
  if (qualityStickyExpired && qualityStickyKey && storage) {
    void storage.removeItem(qualityStickyKey).catch(() => null);
  }

  const activeStickyOffset =
    stickyState && !stickyExpired && Number.isFinite(stickyState.offset) && stickyState.offset > 0
      ? Math.min(SEGMENT_SKIP_MAX_TOTAL_OFFSET, Math.floor(stickyState.offset))
      : 0;
  const stickyLastEndPts =
    stickyState &&
    !stickyExpired &&
    Number.isFinite(stickyState.lastEndPts as number) &&
    Number(stickyState.lastEndPts) > 0
      ? Number(stickyState.lastEndPts)
      : null;
  const qualityStickyLastEndPts =
    qualityStickyState &&
    !qualityStickyExpired &&
    Number.isFinite(qualityStickyState.lastEndPts as number) &&
    Number(qualityStickyState.lastEndPts) > 0
      ? Number(qualityStickyState.lastEndPts)
      : null;

  const stickyMappedUrl =
    activeStickyOffset > 0 ? buildAdvancedSegmentUrl(normalizedUrl, activeStickyOffset) || '' : '';
  const activeQualitySticky =
    qualityStickyState && !qualityStickyExpired && qualityStickyState.quality === '720';
  const qualityMappedUrl = activeQualitySticky
    ? replaceSegmentQualityToken(url, M3U8_1080_PATH_TOKEN, M3U8_720_PATH_TOKEN) || ''
    : '';
  let resolvedUrl = stickyMappedUrl || qualityMappedUrl || normalizedUrl;
  let resolvedOffset = stickyMappedUrl ? activeStickyOffset : 0;
  let resolvedQuality: '1080' | '720' = resolvedUrl.includes(M3U8_720_PATH_TOKEN) ? '720' : '1080';
  const shouldPassthroughSegment = shouldPassthroughSegmentStream(
    resolvedUrl,
    headers,
    isSegmentRequest
  );
  const segmentBodyTimeoutMs = shouldPassthroughSegment ? 0 : DEFAULT_SEGMENT_BODY_TIMEOUT_MS;

  const tsProxyIdentity = toTsProxyIdentity(url, headers);
  const toSegmentCacheKey = (offset: number, quality: '1080' | '720') => {
    const raw = `m3u8-proxy:segment:${SEGMENT_CACHE_KEY_VERSION}:${tsProxyIdentity}:offset=${offset}:quality=${quality}`;
    return `m3u8-proxy:segment:${SEGMENT_CACHE_KEY_VERSION}:${hashKey(raw)}`;
  };
  const cacheLookupKey = toSegmentCacheKey(resolvedOffset, resolvedQuality);

  if (storage) {
    const cachedSegment = await storage
      .getItem<{ contentType: string; bodyBase64: string }>(cacheLookupKey)
      .catch(() => null);

    if (cachedSegment?.bodyBase64) {
      const duration = Date.now() - startTime;
      // logInfo(`✓ Cache HIT (${duration}ms): ${cacheLookupKey}`);
      setHeader(event, 'content-type', cachedSegment.contentType || 'application/octet-stream');
      setHeader(event, 'x-cache', 'HIT');
      setCacheHeaders(event, true);
      return Buffer.from(cachedSegment.bodyBase64, 'base64');
    }
  }

  const releaseProxySlot = acquireProxySlot();
  const response = event.node.res;
  if (response?.once) {
    response.once('finish', releaseProxySlot);
    response.once('close', releaseProxySlot);
  }

  let upstreamResponse = await requestSegmentWithRetry(
    resolvedUrl,
    headers,
    requestedRange,
    segmentBodyTimeoutMs
  ).catch(() => null);
  if (
    (!upstreamResponse || !isSuccessfulSegmentStatus(upstreamResponse.statusCode)) &&
    resolvedOffset > 0
  ) {
    // Sticky offset can become stale; fall back to original segment before failing the request.
    upstreamResponse = await requestSegmentWithRetry(
      normalizedUrl,
      headers,
      requestedRange,
      segmentBodyTimeoutMs
    ).catch(() => null);
    resolvedUrl = normalizedUrl;
    resolvedOffset = 0;
    resolvedQuality = '1080';
    if (stickyKey && storage) {
      void storage.removeItem(stickyKey).catch(() => null);
    }
  }
  if (
    (!upstreamResponse || !isSuccessfulSegmentStatus(upstreamResponse.statusCode)) &&
    resolvedQuality === '720'
  ) {
    upstreamResponse = await requestSegmentWithRetry(
      normalizedUrl,
      headers,
      requestedRange,
      segmentBodyTimeoutMs
    ).catch(() => null);
    resolvedUrl = normalizedUrl;
    resolvedOffset = 0;
    resolvedQuality = '1080';
    if (qualityStickyKey && storage) {
      void storage.removeItem(qualityStickyKey).catch(() => null);
    }
  }

  if (!upstreamResponse || !isSuccessfulSegmentStatus(upstreamResponse.statusCode)) {
    throw createError({
      statusCode: upstreamResponse?.statusCode || 502,
      statusMessage: 'Upstream error',
    });
  }

  const resolveContentType = (response: Awaited<ReturnType<typeof request>>) => {
    const contentTypeHeader = response.headers['content-type'];
    return Array.isArray(contentTypeHeader)
      ? contentTypeHeader[0]
      : contentTypeHeader || 'application/octet-stream';
  };

  let contentType = resolveContentType(upstreamResponse);
  setHeader(event, 'content-type', contentType);

  if (shouldPassthroughSegment) {
    const contentLength = Number(upstreamResponse.headers['content-length'] || 0);
    if (contentLength > getProxyResponseLimit('m3u8')) {
      await upstreamResponse.body.dump().catch(() => null);
      throw createError({
        statusCode: 413,
        statusMessage: 'Upstream response exceeds the configured size limit',
      });
    }
    setResponseStatus(event, upstreamResponse.statusCode);
    setHeaderFromUpstream(event, upstreamResponse.headers, 'accept-ranges');
    setHeaderFromUpstream(event, upstreamResponse.headers, 'cache-control');
    setHeaderFromUpstream(event, upstreamResponse.headers, 'content-disposition');
    setHeaderFromUpstream(event, upstreamResponse.headers, 'content-length');
    setHeaderFromUpstream(event, upstreamResponse.headers, 'content-range');
    setHeaderFromUpstream(event, upstreamResponse.headers, 'etag');
    setHeaderFromUpstream(event, upstreamResponse.headers, 'expires');
    setHeaderFromUpstream(event, upstreamResponse.headers, 'last-modified');
    setHeader(event, 'x-cache', 'MISS');
    setCacheHeaders(event, true);
    event.node.res.flushHeaders?.();
    return sendStream(
      event,
      limitNodeReadable(upstreamResponse.body as any, getProxyResponseLimit('m3u8')) as any
    );
  }

  // If it's a playlist, rewrite internal URLs to go through this proxy too
  let bytes = await readResponseBytes(upstreamResponse, resolvedUrl, 'upstream');
  if (!bytes && resolvedQuality === '1080' && url.includes(M3U8_1080_PATH_TOKEN)) {
    const downgradedUrl = replaceSegmentQualityToken(
      resolvedUrl || url,
      M3U8_1080_PATH_TOKEN,
      M3U8_720_PATH_TOKEN
    );
    if (downgradedUrl && downgradedUrl !== resolvedUrl) {
      const downgradedResponse = await requestSegmentWithRetry(downgradedUrl, headers).catch(
        () => null
      );
      if (downgradedResponse?.statusCode === 200) {
        const downgradedBytes = await readResponseBytes(
          downgradedResponse,
          downgradedUrl,
          'quality fallback'
        );
        const downgradedPts = downgradedBytes ? extractPtsRange(downgradedBytes) : null;
        const fallbackAnchorPts = qualityStickyLastEndPts ?? stickyLastEndPts ?? null;

        if (
          downgradedBytes &&
          !isWeakSegmentPayload(downgradedBytes, downgradedPts) &&
          isPtsContinuityAcceptable(fallbackAnchorPts, downgradedPts)
        ) {
          bytes = downgradedBytes;
          contentType = resolveContentType(downgradedResponse);
          resolvedUrl = downgradedUrl;
          resolvedQuality = '720';
          setHeader(event, 'content-type', contentType);
          setHeader(event, 'x-segment-fallback', 'quality-720-read-error');
        }
      }
    }
  }

  if (!bytes) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Upstream body read error',
    });
  }

  let servedPts = extractPtsRange(bytes);
  const start = bytes.subarray(0, 7).toString('utf8');

  if (isProbablyM3U8(contentType, start)) {
    const manifest = bytes.toString('utf8');
    const origin = getRequestURL(event).origin;
    const proxyPath = '/api/m3u8-proxy';
    const rewritten = rewriteM3U8(manifest, normalizedUrl, origin, proxyPath, headers);

    const duration = Date.now() - startTime;
    // logInfo(`✓ Playlist served (${duration}ms), size: ${manifest.length} bytes`);
    setHeader(event, 'content-type', 'application/vnd.apple.mpegurl; charset=utf-8');
    setHeader(event, 'x-cache', 'MISS');
    setCacheHeaders(event, false);

    return rewritten;
  }

  if (requestedRange) {
    const contentRangeHeader = upstreamResponse.headers['content-range'];
    const normalizedContentRange = Array.isArray(contentRangeHeader)
      ? contentRangeHeader[0]
      : contentRangeHeader;

    setResponseStatus(event, upstreamResponse.statusCode);
    setHeader(event, 'accept-ranges', 'bytes');
    if (normalizedContentRange) {
      setHeader(event, 'content-range', normalizedContentRange);
    }
    setHeader(event, 'x-cache', 'MISS');
    setCacheHeaders(event, true);
    return bytes;
  }

  const previousContinuityAnchorPts = qualityStickyLastEndPts ?? stickyLastEndPts ?? null;
  const continuityAnchorPts = previousContinuityAnchorPts ?? servedPts?.max ?? null;
  let isWeakSegment = isWeakSegmentPayload(bytes, servedPts);

  // UX-first recovery: while staying on 720 sticky, probe 1080 every request and switch back immediately
  // once continuity and segment health are acceptable.
  if (activeQualitySticky && resolvedQuality === '720' && url.includes(M3U8_1080_PATH_TOKEN)) {
    const recover1080Url =
      resolvedOffset > 0 ? buildAdvancedSegmentUrl(url, resolvedOffset) || url : url;
    const recoverResponse = await requestSegmentWithRetry(recover1080Url, headers).catch(
      () => null
    );
    if (recoverResponse && isSuccessfulSegmentStatus(recoverResponse.statusCode)) {
      const recoverType = resolveContentType(recoverResponse);
      const recoverBytes =
        (await readResponseBytes(recoverResponse, recover1080Url, 'quality recovery', false)) ||
        Buffer.alloc(0);
      const recoverPts = extractPtsRange(recoverBytes);
      const recoverWeak = isWeakSegmentPayload(recoverBytes, recoverPts);

      if (!recoverWeak && isPtsContinuityAcceptable(previousContinuityAnchorPts, recoverPts)) {
        bytes = recoverBytes;
        servedPts = recoverPts;
        contentType = recoverType;
        resolvedUrl = recover1080Url;
        resolvedQuality = '1080';
        setHeader(event, 'content-type', contentType);
        setHeader(event, 'x-segment-fallback', 'quality-1080-recover');
        isWeakSegment = false;
      }
    }
  }

  if (resolvedQuality === '1080' && isWeakSegment && url.includes(M3U8_1080_PATH_TOKEN)) {
    const downgradedUrl = replaceSegmentQualityToken(
      resolvedUrl || url,
      M3U8_1080_PATH_TOKEN,
      M3U8_720_PATH_TOKEN
    );
    if (downgradedUrl && downgradedUrl !== resolvedUrl) {
      const downgradedResponse = await requestSegmentWithRetry(downgradedUrl, headers).catch(
        () => null
      );
      if (downgradedResponse && isSuccessfulSegmentStatus(downgradedResponse.statusCode)) {
        const downgradedType = resolveContentType(downgradedResponse);
        const downgradedBytes =
          (await readResponseBytes(downgradedResponse, downgradedUrl, 'quality fallback')) ||
          Buffer.alloc(0);
        const downgradedPts = extractPtsRange(downgradedBytes);
        const downgradedIsWeak = isWeakSegmentPayload(downgradedBytes, downgradedPts);

        if (
          (downgradedBytes.length > bytes.length || !isLikelyTsPayload(bytes)) &&
          !downgradedIsWeak &&
          isPtsContinuityAcceptable(continuityAnchorPts, downgradedPts)
        ) {
          bytes = downgradedBytes;
          servedPts = downgradedPts;
          contentType = downgradedType;
          resolvedUrl = downgradedUrl;
          resolvedQuality = '720';
          setHeader(event, 'content-type', contentType);
          setHeader(event, 'x-segment-fallback', 'quality-720');
        }
      }
    }
  }

  if (shouldTrySegmentSkipFallback(headers, bytes)) {
    const qualityBaseUrl =
      resolvedQuality === '720'
        ? replaceSegmentQualityToken(url, M3U8_1080_PATH_TOKEN, M3U8_720_PATH_TOKEN) || url
        : url;
    for (const advanceBy of buildAdvanceOrder()) {
      const nextOffset = resolvedOffset + advanceBy;
      if (nextOffset > SEGMENT_SKIP_MAX_TOTAL_OFFSET) {
        continue;
      }
      const nextUrl = buildAdvancedSegmentUrl(qualityBaseUrl, nextOffset);
      if (!nextUrl || nextUrl === url) {
        continue;
      }

      const candidate = await requestSegmentWithRetry(nextUrl, headers).catch(() => null);
      if (!candidate || !isSuccessfulSegmentStatus(candidate.statusCode)) {
        continue;
      }

      const candidateType = resolveContentType(candidate);
      const candidateBytes = await readResponseBytesLimited(
        candidate.body,
        getProxyResponseLimit('m3u8')
      ).catch(() => Buffer.alloc(0));
      if (!candidateBytes.length || !isLikelyTsPayload(candidateBytes)) {
        continue;
      }
      const candidatePts = extractPtsRange(candidateBytes);
      if (!isPtsContinuityAcceptable(continuityAnchorPts, candidatePts)) {
        continue;
      }
      if (candidateBytes.length <= bytes.length) {
        continue;
      }

      bytes = candidateBytes;
      servedPts = candidatePts;
      contentType = candidateType;
      resolvedUrl = nextUrl;
      resolvedOffset = nextOffset;
      setHeader(event, 'content-type', contentType);
      setHeader(event, 'x-segment-fallback', `offset-${resolvedOffset}`);
      break;
    }
  }

  if (stickyKey && storage) {
    if (resolvedOffset > 0) {
      void storage
        .setItem(
          stickyKey,
          {
            offset: resolvedOffset,
            stickyUntil: Date.now() + SEGMENT_SKIP_STICKY_SECONDS * 1000,
            setAt: Date.now(),
            lastEndPts: servedPts?.max ?? stickyLastEndPts ?? null,
          } satisfies SegmentSkipStickyState,
          { ttl: SEGMENT_SKIP_STICKY_SECONDS * 2 }
        )
        .catch(err => logWarn('Redis write error (m3u8-proxy segment sticky):', err));
      setHeader(event, 'x-segment-offset', String(resolvedOffset));
    } else if (stickyState) {
      void storage.removeItem(stickyKey).catch(() => null);
    }
  }

  if (qualityStickyKey && storage) {
    if (resolvedQuality === '720') {
      void storage
        .setItem(
          qualityStickyKey,
          {
            quality: '720',
            stickyUntil: Date.now() + SEGMENT_QUALITY_STICKY_SECONDS * 1000,
            setAt: Date.now(),
            lastEndPts: servedPts?.max ?? qualityStickyLastEndPts ?? stickyLastEndPts ?? null,
          } satisfies SegmentQualityStickyState,
          { ttl: SEGMENT_QUALITY_STICKY_SECONDS * 2 }
        )
        .catch(err => logWarn('Redis write error (m3u8-proxy quality sticky):', err));
      setHeader(event, 'x-segment-quality', '720');
    } else if (qualityStickyState) {
      void storage.removeItem(qualityStickyKey).catch(() => null);
    }
  }

  if (storage && bytes.length <= 5 * 1024 * 1024 && !isWeakSegment) {
    const ttl = 15 * 60; // 15 minutes
    const cacheStoreKey = toSegmentCacheKey(resolvedOffset, resolvedQuality);

    void storage
      .setItem(cacheStoreKey, { contentType, bodyBase64: bytes.toString('base64') }, { ttl })
      .catch(err => logWarn('Redis write error (m3u8-proxy segment):', err));

    const duration = Date.now() - startTime;
    // logInfo(`✓ Segment cached (${duration}ms): ${cacheStoreKey}, size: ${bytes.length} bytes`);
  }

  setHeader(event, 'x-cache', 'MISS');
  setCacheHeaders(event, true);
  const duration = Date.now() - startTime;
  // logInfo(`✓ Proxy completed (${duration}ms)`);
  return bytes;
});
