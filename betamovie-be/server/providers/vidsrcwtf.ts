import type { Stream } from './types';

type StorageLike = ReturnType<typeof useStorage>;

interface StreamData {
  masterPlaylistUrl: string;
  referer: string;
  origin: string;
}

interface PremiumEmbedLink {
  host?: string;
  url?: string;
}

interface PremiumEmbedPayload {
  stream?: {
    url?: string;
  };
  links?: PremiumEmbedLink[];
}

interface PlaylistJsonPayload {
  playlist?: Array<{
    sources?: Array<{
      file?: string;
      type?: string;
      label?: string;
    }>;
  }>;
}

const SITE_BASE_URL = process.env.VIDSRCWTF_BASE_URL || 'https://www.vidsrc.wtf';
const SITE_ORIGIN = new URL(SITE_BASE_URL).origin;
const MODERN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const API_REQUEST_UA = process.env.VIDSRCWTF_API_USER_AGENT || 'curl/8.7.1';
const REQUEST_TIMEOUT_MS = Number(process.env.VIDSRCWTF_REQUEST_TIMEOUT_MS || 12_000);
const STREAM_CACHE_TTL = Number(process.env.VIDSRCWTF_CACHE_TTL || 5 * 60);
const STREAM_CACHE_VERSION = 'v2';
const API_BASE_URLS = (
  process.env.VIDSRCWTF_API_BASE_URLS ||
  `${process.env.VIDSRCWTF_API_BASE_URL || 'https://api.rgshows.ru'},https://api.rgshows.me/main`
)
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const MAX_LINKS_TO_TRY = Math.max(1, Number(process.env.VIDSRCWTF_MAX_LINKS || 3));
const MAX_IFRAME_DEPTH = Math.max(0, Number(process.env.VIDSRCWTF_MAX_IFRAME_DEPTH || 1));
const MAX_PLAYLIST_JSON_TO_TRY = Math.max(
  1,
  Number(process.env.VIDSRCWTF_MAX_PLAYLIST_JSON_TO_TRY || 20)
);
const MAX_SOURCE_FILES_TO_TRY = Math.max(
  1,
  Number(process.env.VIDSRCWTF_MAX_SOURCE_FILES_TO_TRY || 20)
);

const M3U8_CONTENT_TYPE_RE = /(?:application|audio)\/(?:vnd\.apple\.mpegurl|x-mpegurl|mpegurl)/i;
const DATA_SCRIPT_RE = /var\s+data\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i;
const BACKUPS_SCRIPT_RE = /var\s+backups\s*=\s*(\[[\s\S]*?\])\s*<\/script>/i;
const IFRAME_SRC_RE = /<iframe[^>]+src=["']([^"']+)["']/gi;

const withTimeout = async (
  url: string,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const buildStreamCacheKey = (
  mediaType: 'movie' | 'tv',
  tmdbId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
) =>
  mediaType === 'movie'
    ? `vidsrcwtf:${STREAM_CACHE_VERSION}:movie:${tmdbId}`
    : `vidsrcwtf:${STREAM_CACHE_VERSION}:tv:${tmdbId}:${seasonNum}:${episodeNum}`;

function buildApiUrl(
  baseUrl: string,
  mediaType: 'movie' | 'tv',
  tmdbId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
): string | null {
  if (mediaType === 'tv' && (seasonNum == null || episodeNum == null)) {
    return null;
  }

  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const usesLegacyMainApi = /\/main$/i.test(normalizedBase);

  if (usesLegacyMainApi) {
    return mediaType === 'movie'
      ? `${normalizedBase}/movie/${encodeURIComponent(tmdbId)}`
      : `${normalizedBase}/tv/${encodeURIComponent(tmdbId)}/${seasonNum}/${episodeNum}`;
  }

  return mediaType === 'movie'
    ? `${normalizedBase}/premium_embeds/movie/${encodeURIComponent(tmdbId)}`
    : `${normalizedBase}/premium_embeds/tv/${encodeURIComponent(tmdbId)}/${seasonNum}/${episodeNum}`;
}

async function getCached<T>(storage: StorageLike | undefined, key: string): Promise<T | null> {
  if (!storage) return null;

  try {
    return (await storage.getItem<T>(key)) || null;
  } catch {
    return null;
  }
}

async function setCached<T>(
  storage: StorageLike | undefined,
  key: string,
  value: T,
  ttl: number
): Promise<void> {
  if (!storage) return;

  try {
    await storage.setItem(key, value as any, { ttl });
  } catch {
    // Ignore cache errors.
  }
}

function normalizeM3u8Url(rawUrl: string): string | null {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;

  try {
    const parsed = new URL(normalized);
    const value = parsed.toString();
    if (!/\.m3u8(?:$|[?#])/i.test(value)) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function extractStreamUrl(payload: any): string | null {
  if (typeof payload?.stream?.url === 'string') {
    const direct = normalizeM3u8Url(payload.stream.url);
    if (direct) {
      return direct;
    }
  }

  if (Array.isArray(payload?.links)) {
    for (const link of payload.links) {
      if (typeof link?.url !== 'string') {
        continue;
      }
      const fromLink = normalizeM3u8Url(link.url);
      if (fromLink) {
        return fromLink;
      }
    }
  }

  return null;
}

async function requestPayload(apiUrl: string): Promise<any | null> {
  const response = await withTimeout(apiUrl, {
    headers: {
      Accept: '*/*',
      'User-Agent': API_REQUEST_UA,
    },
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  return await response.json().catch(() => null);
}

async function requestPayloadWithHeaders(
  apiUrl: string,
  headers: Record<string, string>
): Promise<any | null> {
  const response = await withTimeout(apiUrl, {
    headers,
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  return await response.json().catch(() => null);
}

async function requestText(
  url: string,
  headers: Record<string, string>
): Promise<string | null> {
  const response = await withTimeout(url, { headers }).catch(() => null);
  if (!response?.ok) {
    return null;
  }
  return await response.text().catch(() => null);
}

function normalizeUrl(rawUrl: string): string | null {
  const value = String(rawUrl || '').trim();
  if (!value || /\s/.test(value)) {
    return null;
  }

  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function isLikelyM3u8Manifest(contentType: string, body: string): boolean {
  const trimmed = body.trimStart();
  if (!trimmed.startsWith('#EXTM3U')) {
    return false;
  }

  if (/text\/html/i.test(contentType)) {
    return false;
  }

  // Some providers set generic content types; manifest header is decisive.
  return true;
}

function extractFirstMediaLine(manifest: string): string | null {
  const lines = manifest
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('<')) {
      continue;
    }
    return line;
  }
  return null;
}

async function verifyStreamData(streamData: StreamData): Promise<boolean> {
  const response = await withTimeout(streamData.masterPlaylistUrl, {
    headers: {
      Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*',
      Referer: streamData.referer,
      Origin: streamData.origin,
      'User-Agent': MODERN_UA,
    },
  }).catch(() => null);

  if (!response?.ok) {
    return false;
  }

  const contentType = response.headers.get('content-type') || '';
  const body = await response.text().catch(() => '');
  if (!body) {
    return false;
  }

  if (!isLikelyM3u8Manifest(contentType, body)) {
    return false;
  }

  return Boolean(extractFirstMediaLine(body));
}

function resolveRelativeUrl(rawUrl: string, baseUrl: string): string | null {
  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

function parsePlaylistJsonUrls(embedHtml: string, pageUrl: string): string[] {
  const urls: string[] = [];
  const dataRaw = embedHtml.match(DATA_SCRIPT_RE)?.[1];
  const backupsRaw = embedHtml.match(BACKUPS_SCRIPT_RE)?.[1];

  if (dataRaw) {
    try {
      const data = JSON.parse(dataRaw) as { playlist?: string };
      if (typeof data?.playlist === 'string' && data.playlist.trim()) {
        const resolved = resolveRelativeUrl(data.playlist, pageUrl);
        if (resolved) {
          urls.push(resolved);
        }
      }
    } catch {
      // ignore parser errors
    }
  }

  if (backupsRaw) {
    try {
      const backups = JSON.parse(backupsRaw) as Array<{ url?: string }>;
      for (const backup of backups) {
        if (typeof backup?.url !== 'string' || !backup.url.trim()) {
          continue;
        }
        const resolved = resolveRelativeUrl(backup.url, pageUrl);
        if (resolved) {
          urls.push(resolved);
        }
      }
    } catch {
      // ignore parser errors
    }
  }

  return [...new Set(urls)];
}

function parseIframeUrls(embedHtml: string, pageUrl: string): string[] {
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = IFRAME_SRC_RE.exec(embedHtml)) != null) {
    const raw = match[1];
    const resolved = resolveRelativeUrl(raw, pageUrl);
    if (resolved) {
      urls.push(resolved);
    }
  }
  return [...new Set(urls)];
}

function extractSourceUrls(payload: PlaylistJsonPayload): string[] {
  const urls: string[] = [];
  for (const item of payload?.playlist || []) {
    for (const source of item?.sources || []) {
      if (typeof source?.file !== 'string' || !source.file.trim()) {
        continue;
      }
      const normalized = normalizeUrl(source.file);
      if (normalized) {
        urls.push(normalized);
      }
    }
  }
  return [...new Set(urls)];
}

async function tryPlaylistJson(
  playlistJsonUrl: string,
  pageReferer: string,
  pageOrigin: string
): Promise<StreamData | null> {
  const playlistPayload = await requestPayloadWithHeaders(playlistJsonUrl, {
    Accept: 'application/json,text/plain,*/*',
    Referer: pageReferer,
    Origin: pageOrigin,
    'User-Agent': MODERN_UA,
  });
  if (!playlistPayload) {
    return null;
  }

  const sourceUrls = extractSourceUrls(playlistPayload as PlaylistJsonPayload).slice(
    0,
    MAX_SOURCE_FILES_TO_TRY
  );
  for (const sourceUrl of sourceUrls) {
    const streamData: StreamData = {
      masterPlaylistUrl: sourceUrl,
      referer: pageReferer,
      origin: pageOrigin,
    };
    if (await verifyStreamData(streamData)) {
      return streamData;
    }
  }

  return null;
}

async function resolveFromEmbedPage(
  embedUrl: string,
  depth: number,
  visited: Set<string>
): Promise<StreamData | null> {
  if (visited.has(embedUrl) || depth > MAX_IFRAME_DEPTH) {
    return null;
  }
  visited.add(embedUrl);

  const embedOrigin = new URL(embedUrl).origin;
  const embedHtml = await requestText(embedUrl, {
    Accept: 'text/html,application/xhtml+xml,*/*',
    Referer: `${SITE_ORIGIN}/`,
    Origin: SITE_ORIGIN,
    'User-Agent': MODERN_UA,
  });

  if (!embedHtml) {
    return null;
  }

  const playlistJsonUrls = parsePlaylistJsonUrls(embedHtml, embedUrl).slice(
    0,
    MAX_PLAYLIST_JSON_TO_TRY
  );
  for (const playlistJsonUrl of playlistJsonUrls) {
    const resolved = await tryPlaylistJson(playlistJsonUrl, embedUrl, embedOrigin);
    if (resolved) {
      return resolved;
    }
  }

  const iframeUrls = parseIframeUrls(embedHtml, embedUrl);
  for (const iframeUrl of iframeUrls) {
    const resolved = await resolveFromEmbedPage(iframeUrl, depth + 1, visited);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

async function resolveFromLinks(links: PremiumEmbedLink[]): Promise<StreamData | null> {
  const candidates = links
    .map(link => (typeof link?.url === 'string' ? link.url.trim() : ''))
    .filter(Boolean)
    .map(url => normalizeUrl(url))
    .filter((url): url is string => Boolean(url))
    .slice(0, MAX_LINKS_TO_TRY);

  const visited = new Set<string>();
  for (const candidate of candidates) {
    const resolved = await resolveFromEmbedPage(candidate, 0, visited);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

async function resolveStream(
  mediaType: 'movie' | 'tv',
  tmdbId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
): Promise<StreamData | null> {
  for (const apiBase of API_BASE_URLS) {
    const apiUrl = buildApiUrl(apiBase, mediaType, tmdbId, seasonNum, episodeNum);
    if (!apiUrl) {
      continue;
    }

    // Preferred request profile for links payload (what vidsrc.wtf browser flow uses).
    const linksPayload = (await requestPayloadWithHeaders(apiUrl, {
      Accept: 'application/json,text/plain,*/*',
      Origin: SITE_ORIGIN,
      Referer: `${SITE_ORIGIN}/`,
      'User-Agent': MODERN_UA,
    })) as PremiumEmbedPayload | null;

    if (Array.isArray(linksPayload?.links) && linksPayload.links.length > 0) {
      const resolvedFromLinks = await resolveFromLinks(linksPayload.links);
      if (resolvedFromLinks) {
        return resolvedFromLinks;
      }
    }

    // Fallback to direct stream payload profile.
    const payload = (await requestPayload(apiUrl)) as PremiumEmbedPayload | null;
    const streamUrl = extractStreamUrl(payload);
    if (streamUrl) {
      const streamData: StreamData = {
        masterPlaylistUrl: streamUrl,
        referer: `${SITE_ORIGIN}/`,
        origin: SITE_ORIGIN,
      };

      const isVerified = await verifyStreamData(streamData);
      if (!isVerified) {
        console.warn(`[VidSrcWtf] Rejected non-playable stream URL from ${apiBase}: ${streamUrl}`);
      } else {
        return streamData;
      }
    }
  }

  return null;
}

export async function getVidsrcWtfStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv' = 'movie',
  seasonNum?: number | null,
  episodeNum?: number | null,
  storage?: StorageLike,
  _context?: { title?: string; releaseYear?: number }
): Promise<Stream[]> {
  try {
    const cacheKey = buildStreamCacheKey(mediaType, tmdbId, seasonNum, episodeNum);
    const cached = await getCached<StreamData>(storage, cacheKey);
    const cachedIsValid = cached ? await verifyStreamData(cached) : false;
    const streamData =
      (cachedIsValid ? cached : null) || (await resolveStream(mediaType, tmdbId, seasonNum, episodeNum));
    if (!streamData) {
      if (cached && !cachedIsValid && storage) {
        await storage.removeItem(cacheKey).catch(() => null);
      }
      return [];
    }

    await setCached(storage, cacheKey, streamData, STREAM_CACHE_TTL);

    return [
      {
        name: 'VidSrc.wtf - Auto',
        title: 'VidSrc.wtf - High Quality',
        url: streamData.masterPlaylistUrl,
        subtitle: '',
        quality: '1080p',
        provider: 'vidsrcwtf',
        headers: {
          Referer: streamData.referer,
          Origin: streamData.origin,
          'User-Agent': MODERN_UA,
        },
      },
    ];
  } catch (error: any) {
    console.error(`[VidSrcWtf] Error: ${error?.message || String(error)}`);
    return [];
  }
}
