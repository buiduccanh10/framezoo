import { Buffer } from 'node:buffer';
import { createContext, runInContext } from 'node:vm';
import type { Stream } from './types';

type StorageLike = ReturnType<typeof useStorage>;

interface ServerEntry {
  name?: string;
  data?: string;
}

interface ResolvedServers {
  basePath: string;
  method: string;
  headers: Record<string, string>;
  servers: ServerEntry[];
}

interface StreamData {
  masterPlaylistUrl: string;
  referer: string;
  origin: string;
}

const SITE_BASE_URL = process.env.MOVIES111_BASE_URL || 'https://111movies.net';
const SITE_ORIGIN = new URL(SITE_BASE_URL).origin;
const MODERN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = Number(process.env.MOVIES111_REQUEST_TIMEOUT_MS || 18_000);
const STREAM_CACHE_TTL = Number(process.env.MOVIES111_CACHE_TTL || 5 * 60);
const CHUNK_CACHE_TTL_MS = Number(process.env.MOVIES111_CHUNK_CACHE_TTL_MS || 60 * 60 * 1000);
const SERVER_LIST_TIMEOUT_MS = Number(process.env.MOVIES111_SERVER_LIST_TIMEOUT_MS || 15_000);
const MAX_SERVERS_TO_TRY = Math.max(1, Number(process.env.MOVIES111_MAX_SERVERS || 12));

let cachedChunk: { url: string; source: string; fetchedAt: number } | null = null;

const withTimeout = async (
  url: string,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const buildStreamCacheKey = (
  mediaType: 'movie' | 'tv',
  tmdbId: string,
  seasonNum?: number | null,
  episodeNum?: number | null
) =>
  mediaType === 'movie'
    ? `111movies:movie:${tmdbId}`
    : `111movies:tv:${tmdbId}:${seasonNum}:${episodeNum}`;

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
    // Ignore cache failures.
  }
}

function buildPageUrl(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  seasonNum?: number | null,
  episodeNum?: number | null
): string | null {
  if (mediaType === 'movie') {
    return `${SITE_ORIGIN}/movie/${encodeURIComponent(tmdbId)}`;
  }
  if (seasonNum == null || episodeNum == null) {
    return null;
  }
  return `${SITE_ORIGIN}/tv/${encodeURIComponent(tmdbId)}/${seasonNum}/${episodeNum}`;
}

async function fetchPageHtml(pageUrl: string): Promise<string | null> {
  const response = await withTimeout(pageUrl, {
    headers: {
      'User-Agent': MODERN_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: `${SITE_ORIGIN}/`,
      'Cache-Control': 'no-cache',
    },
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }
  return await response.text().catch(() => null);
}

function extractPageData(html: string): string | null {
  const direct = html.match(/"data":"([^"]+)"/)?.[1];
  if (direct && direct.trim()) {
    return direct.trim();
  }
  return null;
}

function extractChunkUrlFromHtml(html: string): string | null {
  const direct = html.match(/src="([^"]*\/_next\/static\/chunks\/279-[^"]+\.js)"/i)?.[1];
  if (direct) {
    return new URL(direct, SITE_ORIGIN).toString();
  }
  return null;
}

async function fetchChunkSource(chunkUrl: string): Promise<string | null> {
  if (cachedChunk && cachedChunk.url === chunkUrl && Date.now() - cachedChunk.fetchedAt < CHUNK_CACHE_TTL_MS) {
    return cachedChunk.source;
  }

  const response = await withTimeout(chunkUrl, {
    headers: {
      'User-Agent': MODERN_UA,
      Accept: 'application/javascript,text/plain,*/*',
      Referer: `${SITE_ORIGIN}/`,
      Origin: SITE_ORIGIN,
    },
  }).catch(() => null);
  if (!response?.ok) {
    return null;
  }

  const source = await response.text().catch(() => null);
  if (!source) {
    return null;
  }

  cachedChunk = {
    url: chunkUrl,
    source,
    fetchedAt: Date.now(),
  };
  return source;
}

function inferBasePath(refs: Array<{ current: any }>, triggerUrl?: string): string | null {
  const fromRef = refs
    .map(ref => ref?.current)
    .find(value => typeof value === 'string' && value.includes('/') && !/^https?:\/\//i.test(value));
  if (typeof fromRef === 'string' && fromRef.trim()) {
    return fromRef.trim().replace(/^\/+|\/+$/g, '');
  }

  if (!triggerUrl) return null;
  try {
    const parsed = new URL(triggerUrl);
    const parts = parsed.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts.length < 3) return null;
    const maybeSuffix = parts[parts.length - 1]?.toLowerCase();
    if (!['sr', 'ns', 'ne'].includes(maybeSuffix)) return null;
    parts.pop();
    parts.pop();
    return parts.join('/');
  } catch {
    return null;
  }
}

function inferMethod(refs: Array<{ current: any }>): string {
  const fromRef = refs
    .map(ref => ref?.current)
    .find(value => typeof value === 'string' && /^(GET|POST|PUT|PATCH|DELETE)$/i.test(value));
  return typeof fromRef === 'string' ? fromRef.toUpperCase() : 'POST';
}

function inferApiHeaders(refs: Array<{ current: any }>): Record<string, string> {
  const fromRef = refs
    .map(ref => ref?.current)
    .find(
      value =>
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof value['Content-Type'] === 'string'
    );
  if (fromRef) {
    return { ...(fromRef as Record<string, string>) };
  }
  return { 'Content-Type': 'application/atom+xml' };
}

async function resolveServersViaSandbox(
  chunkSource: string,
  pageData: string,
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  seasonNum?: number | null,
  episodeNum?: number | null
): Promise<ResolvedServers | null> {
  const modules: Record<string, any> = {};
  const refs: Array<{ current: any }> = [];
  const stateStore: any[] = [];
  const timers = new Set<any>();
  const intervals = new Set<any>();

  let settled = false;
  let resolveDone: ((value: ResolvedServers) => void) | null = null;
  let rejectDone: ((reason?: any) => void) | null = null;

  const donePromise = new Promise<ResolvedServers>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const timeoutId = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectDone?.(new Error('Timed out waiting for 111movies server list'));
    }
  }, SERVER_LIST_TIMEOUT_MS);

  const setTimeoutWrapped = (handler: (...args: any[]) => any, ms?: number, ...args: any[]) => {
    const id = setTimeout(handler, ms, ...args);
    timers.add(id);
    return id;
  };

  const clearTimeoutWrapped = (id: any) => {
    timers.delete(id);
    clearTimeout(id);
  };

  const setIntervalWrapped = (handler: (...args: any[]) => any, ms?: number, ...args: any[]) => {
    const id = setInterval(handler, ms, ...args);
    intervals.add(id);
    return id;
  };

  const clearIntervalWrapped = (id: any) => {
    intervals.delete(id);
    clearInterval(id);
  };

  const originLocation =
    mediaType === 'movie'
      ? `${SITE_ORIGIN}/movie/${tmdbId}`
      : `${SITE_ORIGIN}/tv/${tmdbId}/${seasonNum}/${episodeNum}`;

  const runtimeNavigator = {
    userAgent: MODERN_UA,
    platform: 'MacIntel',
    language: 'en-US',
    maxTouchPoints: 0,
    plugins: { namedItem: () => null },
  };

  const localStore = new Map<string, string>();

  const sandbox: Record<string, any> = {
    modules,
    Buffer,
    URL,
    URLSearchParams,
    AbortController,
    AbortSignal,
    parseInt,
    console,
    setTimeout: setTimeoutWrapped,
    clearTimeout: clearTimeoutWrapped,
    setInterval: setIntervalWrapped,
    clearInterval: clearIntervalWrapped,
    requestAnimationFrame: (cb: (time: number) => void) => setTimeoutWrapped(() => cb(Date.now()), 10),
    cancelAnimationFrame: (id: any) => clearTimeoutWrapped(id),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    parent: { postMessage: () => undefined },
    location: new URL(originLocation),
    screen: { width: 1920, height: 1080, colorDepth: 24 },
    navigator: runtimeNavigator,
    localStorage: {
      getItem: (key: string) => localStore.get(key) || null,
      setItem: (key: string, value: string) => localStore.set(key, String(value)),
      removeItem: (key: string) => localStore.delete(key),
    },
    document: {
      body: { appendChild: () => undefined },
      head: { appendChild: () => undefined },
      createElement: (tag: string) => {
        if (tag === 'canvas') {
          return {
            getContext: () => ({ fillText: () => undefined }),
            toDataURL: () => 'data:image/png;base64,AAAA',
          };
        }
        return { style: {}, appendChild: () => undefined };
      },
      querySelector: (selector: string) => {
        if (selector === '.mainplayer') {
          return {
            querySelector: () => ({
              addEventListener: () => undefined,
              removeEventListener: () => undefined,
            }),
          };
        }
        return { content: 'origin', querySelector: () => ({}) };
      },
      getElementsByTagName: (name: string) =>
        name === 'body' ? [{ appendChild: () => undefined }] : [],
    },
    chrome: {
      runtime: {},
      cast: { media: { DEFAULT_MEDIA_RECEIVER_APP_ID: 'x' }, AutoJoinPolicy: { ORIGIN_SCOPED: 'x' } },
    },
    fetch: async (url: string, init: RequestInit = {}) => {
      const absolute = new URL(String(url), SITE_ORIGIN).toString();
      const response = await withTimeout(absolute, init).catch(() => null);
      if (!response) {
        throw new Error(`Failed to fetch ${absolute}`);
      }

      if (!settled && String(init.method || 'GET').toUpperCase() === 'POST') {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const text = await response.clone().text().catch(() => '');
          try {
            const parsed = JSON.parse(text) as any;
            if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0]?.data === 'string') {
              settled = true;
              const basePath = inferBasePath(refs, absolute);
              if (basePath) {
                resolveDone?.({
                  basePath,
                  method: inferMethod(refs),
                  headers: inferApiHeaders(refs),
                  servers: parsed,
                });
              }
            }
          } catch {
            // ignore non-json payloads
          }
        }
      }

      return response;
    },
  };

  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.webpackChunk_N_E = {
    push: (arr: any[]) => {
      Object.assign(modules, arr[1] || {});
    },
  };

  const context = createContext(sandbox);

  const reactStub = {
    useState(init: any) {
      const value = typeof init === 'function' ? init() : init;
      const index = stateStore.length;
      stateStore.push(value);
      const setState = (updater: any) => {
        stateStore[index] = typeof updater === 'function' ? updater(stateStore[index]) : updater;
      };
      return [value, setState] as const;
    },
    useRef(init: any) {
      const ref = { current: init };
      refs.push(ref);
      return ref;
    },
    useEffect(effect: () => void) {
      try {
        effect();
      } catch {
        // swallow non-critical effect errors in sandbox
      }
    },
  };

  const dependencyStubs: Record<number, any> = {
    4848: { jsx: () => null, jsxs: () => null, Fragment: 'fragment' },
    6540: reactStub,
    6715: {
      useRouter: () => ({
        query:
          mediaType === 'movie'
            ? { id: tmdbId }
            : { id: tmdbId, season: String(seasonNum || ''), episode: String(episodeNum || '') },
      }),
    },
    5212: { hb: () => ({ reset: () => undefined }) },
    961: { unstable_batchedUpdates: (fn: () => void) => fn() },
    1179: { f: async () => ({ cues: [] }) },
    4624: await import('node:crypto'),
    5606: sandbox,
    2928: { Buffer },
    1823: () => null,
    4032: { A: () => null },
    1703: () => null,
    7235: { A: () => null },
    4682: { A: () => null },
    7674: { A: () => null },
    5131: { Ay: () => null },
    2752: { Ay: () => null },
    5121: { A: () => null },
    8133: () => null,
  };

  const req = ((id: number) => dependencyStubs[id] ?? {}) as any;
  req.d = (exports: Record<string, any>, definition: Record<string, () => any>) => {
    for (const key of Object.keys(definition)) {
      Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
    }
  };
  req.r = (exports: Record<string, any>) => {
    Object.defineProperty(exports, '__esModule', { value: true });
  };

  try {
    runInContext(chunkSource, context, { timeout: 8_000 });
    const moduleFn = modules['7279'];
    if (typeof moduleFn !== 'function') {
      return null;
    }

    const module = { exports: {} as any };
    moduleFn(module, module.exports, req);
    const component = module.exports?.A;
    if (typeof component !== 'function') {
      return null;
    }

    component({
      option: {
        _id: tmdbId,
        _season: seasonNum != null ? String(seasonNum) : undefined,
        _episode: episodeNum != null ? String(episodeNum) : undefined,
        _data: pageData,
        _theme: undefined,
        _nextbutton: true,
        _autonext: true,
        _backdrop: 'x.jpg',
        autoplay: false,
        muted: false,
        progress: null,
        ad: true,
      },
    });

    const result = await donePromise.catch(() => null);
    return result;
  } finally {
    clearTimeout(timeoutId);
    for (const id of timers) clearTimeout(id);
    for (const id of intervals) clearInterval(id);
  }
}

function normalizeM3u8Url(rawUrl: string): string | null {
  const value = String(rawUrl || '').trim();
  if (!value || /\s/.test(value)) return null;

  try {
    const parsed = new URL(value);
    const normalized = parsed.toString();
    return /\.m3u8(?:$|[?#])/i.test(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function extractFirstMediaLine(playlist: string): string | null {
  for (const line of playlist.split(/\r?\n/).map(value => value.trim())) {
    if (!line || line.startsWith('#') || line.startsWith('<')) continue;
    return line;
  }
  return null;
}

async function verifyPlayableStream(streamUrl: string, referer: string, origin: string): Promise<boolean> {
  const playlistResponse = await withTimeout(streamUrl, {
    headers: {
      Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*',
      Referer: referer,
      Origin: origin,
      'User-Agent': MODERN_UA,
    },
  }).catch(() => null);
  if (!playlistResponse?.ok) {
    return false;
  }

  const playlistText = await playlistResponse.text().catch(() => '');
  if (!playlistText || !playlistText.includes('#EXTM3U')) {
    return false;
  }

  const firstLine = extractFirstMediaLine(playlistText);
  if (!firstLine) {
    return false;
  }

  let segmentUrl = new URL(firstLine, streamUrl).toString();
  if (/\.m3u8(?:$|[?#])/i.test(segmentUrl)) {
    const childResponse = await withTimeout(segmentUrl, {
      headers: {
        Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*',
        Referer: referer,
        Origin: origin,
        'User-Agent': MODERN_UA,
      },
    }).catch(() => null);
    if (!childResponse?.ok) {
      return false;
    }
    const childText = await childResponse.text().catch(() => '');
    const childLine = extractFirstMediaLine(childText);
    if (!childLine) {
      return false;
    }
    segmentUrl = new URL(childLine, segmentUrl).toString();
  }

  const segmentResponse = await withTimeout(segmentUrl, {
    headers: {
      Accept: '*/*',
      Referer: referer,
      Origin: origin,
      'User-Agent': MODERN_UA,
    },
  }).catch(() => null);
  if (!segmentResponse?.ok) {
    return false;
  }

  const segmentBytes = await segmentResponse.arrayBuffer().catch(() => null);
  return Boolean(segmentBytes && segmentBytes.byteLength > 0);
}

async function resolveStreamData(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  seasonNum?: number | null,
  episodeNum?: number | null
): Promise<StreamData | null> {
  const pageUrl = buildPageUrl(tmdbId, mediaType, seasonNum, episodeNum);
  if (!pageUrl) return null;

  const html = await fetchPageHtml(pageUrl);
  if (!html) return null;

  const pageData = extractPageData(html);
  if (!pageData) return null;

  const chunkUrl = extractChunkUrlFromHtml(html) || cachedChunk?.url;
  if (!chunkUrl) return null;

  const chunkSource = await fetchChunkSource(chunkUrl);
  if (!chunkSource) return null;

  const resolvedServers = await resolveServersViaSandbox(
    chunkSource,
    pageData,
    tmdbId,
    mediaType,
    seasonNum,
    episodeNum
  );
  if (!resolvedServers?.servers?.length || !resolvedServers.basePath) {
    return null;
  }

  const requestHeaders = {
    ...resolvedServers.headers,
    Referer: pageUrl,
    Origin: SITE_ORIGIN,
    'User-Agent': MODERN_UA,
    Accept: '*/*',
  };

  for (const server of resolvedServers.servers.slice(0, MAX_SERVERS_TO_TRY)) {
    if (typeof server?.data !== 'string' || !server.data.trim()) {
      continue;
    }

    const endpoint = `${SITE_ORIGIN}/${resolvedServers.basePath}/${server.data.trim()}`;
    const response = await withTimeout(
      endpoint,
      { method: resolvedServers.method || 'POST', headers: requestHeaders },
      REQUEST_TIMEOUT_MS
    ).catch(() => null);
    if (!response?.ok) {
      continue;
    }

    const payloadText = await response.text().catch(() => '');
    if (!payloadText) {
      continue;
    }

    let payload: any;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      continue;
    }

    const m3u8Url = normalizeM3u8Url(payload?.url || payload?.stream?.url || '');
    if (!m3u8Url) {
      continue;
    }

    const streamReferer = payload?.noReferrer ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}/`;
    const playable = await verifyPlayableStream(m3u8Url, streamReferer, SITE_ORIGIN);
    if (!playable) {
      continue;
    }

    return {
      masterPlaylistUrl: m3u8Url,
      referer: streamReferer,
      origin: SITE_ORIGIN,
    };
  }

  return null;
}

export async function get111MoviesStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv' = 'movie',
  seasonNum?: number | null,
  episodeNum?: number | null,
  storage?: StorageLike,
  _context?: { title?: string; releaseYear?: number }
): Promise<Stream[]> {
  try {
    if (mediaType === 'tv' && (seasonNum == null || episodeNum == null)) {
      return [];
    }

    const cacheKey = buildStreamCacheKey(mediaType, tmdbId, seasonNum, episodeNum);
    const cached = await getCached<StreamData>(storage, cacheKey);
    const streamData =
      cached ||
      (await (async () => {
        const resolved = await resolveStreamData(tmdbId, mediaType, seasonNum, episodeNum);
        if (!resolved) return null;
        await setCached(storage, cacheKey, resolved, STREAM_CACHE_TTL);
        return resolved;
      })());

    if (!streamData) {
      return [];
    }

    return [
      {
        name: '111Movies - Auto',
        title: '111Movies - High Quality',
        url: streamData.masterPlaylistUrl,
        subtitle: '',
        quality: '1080p',
        provider: '111movies',
        headers: {
          Referer: streamData.referer,
          Origin: streamData.origin,
          'User-Agent': MODERN_UA,
        },
      },
    ];
  } catch (error: any) {
    console.error(`[111Movies] Error: ${error?.message || String(error)}`);
    return [];
  }
}
