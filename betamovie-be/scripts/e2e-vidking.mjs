#!/usr/bin/env node

/**
 * End-to-end check for Vidking provider:
 * 1) backend stream endpoint returns one or more quality-labelled streams
 * 2) optional required qualities are present in the returned list
 * 3) at least one returned playlist resolves to a fetchable media segment
 *
 * Usage:
 *   node scripts/e2e-vidking.mjs --type movie --id 550
 *   node scripts/e2e-vidking.mjs --type tv --id 1399 --season 1 --episode 1
 *   node scripts/e2e-vidking.mjs --type tv --id 220102 --season 1 --episode 6 --require-quality 4K --require-quality 1080p
 */

const args = process.argv.slice(2);

const getArg = key => {
  const index = args.indexOf(`--${key}`);
  return index === -1 ? null : (args[index + 1] ?? null);
};

const getArgs = key => {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== `--${key}`) continue;
    const nextValue = args[index + 1];
    if (!nextValue || nextValue.startsWith('--')) continue;
    values.push(nextValue);
  }
  return values;
};

const required = (name, value) => {
  if (value == null || value === '') {
    console.error(`Missing --${name}`);
    process.exit(1);
  }
};

const normalizeQuality = rawValue => {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if (/^(auto|adaptive)$/i.test(value)) return 'Auto';
  if (/(?:^|\b)(4k|uhd|2160)(?:\b|p)/i.test(value)) return '4K';
  const match = value.match(/(\d{3,4})/);
  return match ? `${match[1]}p` : value;
};

const type = (getArg('type') || 'movie').trim().toLowerCase();
const id = (getArg('id') || '').trim();
const season = Number.parseInt(getArg('season') || '', 10);
const episode = Number.parseInt(getArg('episode') || '', 10);
const backendBase = (getArg('backend-base') || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const internalToken = (getArg('internal-token') || process.env.INTERNAL_API_TOKEN || '').trim();
const requiredQualities = getArgs('require-quality')
  .flatMap(value => value.split(','))
  .map(normalizeQuality)
  .filter(Boolean);
const FETCH_TIMEOUT_MS = Number.parseInt(getArg('timeout-ms') || '', 10) || 15_000;
const SEGMENT_TIMEOUT_MS = Number.parseInt(getArg('segment-timeout-ms') || '', 10) || 12_000;
const MAX_MEDIA_LINES_TO_PROBE = Number.parseInt(getArg('max-media-lines') || '', 10) || 4;

required('id', id);

if (type !== 'movie' && type !== 'tv') {
  console.error("Invalid --type. Use 'movie' or 'tv'.");
  process.exit(1);
}

if (type === 'tv' && (!Number.isFinite(season) || !Number.isFinite(episode))) {
  console.error('TV mode requires --season and --episode');
  process.exit(1);
}

const streamEndpoint =
  type === 'movie'
    ? `${backendBase}/api/embed/api/streams/vidking/movie/${encodeURIComponent(id)}`
    : `${backendBase}/api/embed/api/streams/vidking/tv/${encodeURIComponent(id)}/${season}/${episode}`;

const streamEndpointWithToken = internalToken
  ? `${streamEndpoint}?internalToken=${encodeURIComponent(internalToken)}`
  : streamEndpoint;

function withToken(rawUrl) {
  if (!internalToken) return rawUrl;
  const parsed = new URL(rawUrl);
  if (!parsed.searchParams.get('internalToken')) {
    parsed.searchParams.set('internalToken', internalToken);
  }
  return parsed.toString();
}

async function fetchWithTimeout(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
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
}

function extractMediaLines(manifest) {
  return manifest
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !line.startsWith('<'));
}

async function fetchManifest(url) {
  const response = await fetchWithTimeout(url, { headers: { Accept: '*/*' } }).catch(() => null);
  if (!response?.ok) {
    return null;
  }

  const text = await response.text().catch(() => '');
  return text.trimStart().startsWith('#EXTM3U') ? { url, response, text } : null;
}

async function fetchSegmentPreview(url) {
  const response = await fetchWithTimeout(
    url,
    {
      headers: { Accept: '*/*', Range: 'bytes=0-4095' },
    },
    SEGMENT_TIMEOUT_MS
  ).catch(() => null);
  if (!response?.ok) {
    return null;
  }

  const buffer = await response.arrayBuffer().catch(() => null);
  return buffer?.byteLength ? { response, buffer } : null;
}

async function resolvePlayableStreamLeaf(playlistUrl, depth = 0, seen = new Set()) {
  if (depth > 4 || seen.has(playlistUrl)) {
    return null;
  }

  seen.add(playlistUrl);
  const manifest = await fetchManifest(playlistUrl);
  if (!manifest) {
    return null;
  }

  for (const line of extractMediaLines(manifest.text).slice(0, MAX_MEDIA_LINES_TO_PROBE)) {
    const candidateUrl = withToken(new URL(line, playlistUrl).toString());
    if (/\.m3u8(?:$|[?#])/i.test(line)) {
      const nested = await resolvePlayableStreamLeaf(candidateUrl, depth + 1, seen);
      if (nested) {
        return nested;
      }
      continue;
    }

    const preview = await fetchSegmentPreview(candidateUrl);
    if (!preview) {
      continue;
    }

    return {
      playlistUrl,
      firstSegmentUrl: candidateUrl,
      segmentResponse: preview.response,
      segmentBuffer: preview.buffer,
    };
  }

  return null;
}

function streamProbePriority(stream) {
  const quality = normalizeQuality(stream?.quality);
  if (quality === '720p') return 0;
  if (quality === '480p' || quality === '692p') return 1;
  if (quality === '1080p') return 2;
  if (quality === '360p' || quality === '346p') return 3;
  if (quality === '4K') return 4;
  if (quality === 'Auto') return 5;
  return 6;
}

const streamResponse = await fetchWithTimeout(streamEndpointWithToken, {
  headers: { Accept: 'application/json' },
});

if (!streamResponse.ok) {
  console.error(`HTTP ${streamResponse.status} from ${streamEndpointWithToken}`);
  process.exit(1);
}

const streamPayload = await streamResponse.json().catch(() => null);
const returnedStreams = Array.isArray(streamPayload?.streams) ? streamPayload.streams : [];
if (!streamPayload?.success || !streamPayload?.count || !returnedStreams.length) {
  console.error('No playable stream returned from backend provider');
  console.error(JSON.stringify(streamPayload));
  process.exit(1);
}

const qualities = returnedStreams
  .map(stream => String(stream?.quality || '').trim())
  .map(normalizeQuality)
  .filter(Boolean);
const uniqueQualities = [...new Set(qualities)];
const probeCandidates = [...returnedStreams].sort(
  (left, right) => streamProbePriority(left) - streamProbePriority(right)
);

if (requiredQualities.length) {
  const missingQualities = requiredQualities.filter(quality => !uniqueQualities.includes(quality));
  if (missingQualities.length) {
    console.error(`Missing required qualities: ${missingQualities.join(', ')}`);
    console.error(`Available qualities: ${uniqueQualities.join(', ') || 'n/a'}`);
    console.error(
      JSON.stringify(
        returnedStreams.map(stream => ({
          title: String(stream?.title || stream?.name || '').trim(),
          quality: normalizeQuality(stream?.quality),
          url: String(stream?.url || ''),
        })),
        null,
        2
      )
    );
    process.exit(1);
  }
}

let playable = null;

for (const stream of probeCandidates) {
  const candidateUrl = withToken(String(stream?.url || ''));
  if (!candidateUrl) continue;

  const resolvedLeaf = await resolvePlayableStreamLeaf(candidateUrl);
  if (!resolvedLeaf) {
    continue;
  }

  playable = {
    stream,
    ...resolvedLeaf,
  };
  break;
}

if (!playable) {
  console.error('No playable playlist returned from backend provider');
  console.error(JSON.stringify(streamPayload));
  process.exit(1);
}

console.log(`[PASS] ${type.toUpperCase()} ${id}`);
console.log(`stream endpoint: ${streamEndpointWithToken}`);
console.log(`qualities: ${uniqueQualities.join(', ') || 'n/a'}`);
if (requiredQualities.length) {
  console.log(`required qualities: ${requiredQualities.join(', ')}`);
}
console.log(`playable stream: ${String(playable.stream?.title || playable.stream?.name || '').trim()}`);
console.log(`playlist: ${playable.playlistUrl}`);
console.log(`first segment uri: ${playable.firstSegmentUrl}`);
console.log(
  `first segment content-type: ${playable.segmentResponse.headers.get('content-type') || ''}`
);
console.log(`first segment bytes: ${playable.segmentBuffer.byteLength}`);
