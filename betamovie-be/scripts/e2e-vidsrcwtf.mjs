#!/usr/bin/env node

/**
 * End-to-end check for VidSrc.wtf provider:
 * 1) backend stream endpoint returns a proxied playlist URL
 * 2) proxied playlist is a valid M3U8 manifest
 * 3) first media URI is fetchable
 * 4) if first media URI is a nested playlist, first segment is fetchable
 *
 * Usage:
 *   node scripts/e2e-vidsrcwtf.mjs --type movie --id 550
 *   node scripts/e2e-vidsrcwtf.mjs --type tv --id 1399 --season 1 --episode 1
 */

const args = process.argv.slice(2);

const getArg = key => {
  const index = args.indexOf(`--${key}`);
  return index === -1 ? null : args[index + 1] ?? null;
};

const required = (name, value) => {
  if (value == null || value === '') {
    console.error(`Missing --${name}`);
    process.exit(1);
  }
};

const type = (getArg('type') || 'movie').trim().toLowerCase();
const id = (getArg('id') || '').trim();
const season = Number.parseInt(getArg('season') || '', 10);
const episode = Number.parseInt(getArg('episode') || '', 10);
const backendBase = (getArg('backend-base') || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const internalToken = (getArg('internal-token') || process.env.INTERNAL_API_TOKEN || '').trim();

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
    ? `${backendBase}/api/embed/api/streams/vidsrcwtf/movie/${encodeURIComponent(id)}`
    : `${backendBase}/api/embed/api/streams/vidsrcwtf/tv/${encodeURIComponent(id)}/${season}/${episode}`;

const streamEndpointWithToken = internalToken
  ? `${streamEndpoint}?internalToken=${encodeURIComponent(internalToken)}`
  : streamEndpoint;

const streamResponse = await fetch(streamEndpointWithToken, {
  headers: { Accept: 'application/json' },
});

if (!streamResponse.ok) {
  console.error(`HTTP ${streamResponse.status} from ${streamEndpointWithToken}`);
  process.exit(1);
}

const streamPayload = await streamResponse.json().catch(() => null);
const proxiedUrl = streamPayload?.streams?.[0]?.url;
if (!streamPayload?.success || !streamPayload?.count || typeof proxiedUrl !== 'string') {
  console.error('No playable stream returned from backend provider');
  console.error(JSON.stringify(streamPayload));
  process.exit(1);
}

const proxiedPlaylistUrl = (() => {
  if (!internalToken) return proxiedUrl;
  const parsed = new URL(proxiedUrl);
  if (!parsed.searchParams.get('internalToken')) {
    parsed.searchParams.set('internalToken', internalToken);
  }
  return parsed.toString();
})();

const playlistResponse = await fetch(proxiedPlaylistUrl, { headers: { Accept: '*/*' } });
if (!playlistResponse.ok) {
  console.error(`Playlist request failed: HTTP ${playlistResponse.status}`);
  process.exit(1);
}

const playlistText = await playlistResponse.text();
if (!playlistText.trimStart().startsWith('#EXTM3U')) {
  console.error('Playlist is not valid M3U8');
  console.error(playlistText.slice(0, 500));
  process.exit(1);
}

const mediaLine = playlistText
  .split(/\r?\n/)
  .map(line => line.trim())
  .find(line => line && !line.startsWith('#'));

if (!mediaLine) {
  console.error('No media URI line found in playlist');
  process.exit(1);
}

const firstMediaUrl = (() => {
  const resolved = new URL(mediaLine, proxiedPlaylistUrl);
  if (!internalToken) return resolved.toString();
  if (!resolved.searchParams.get('internalToken')) {
    resolved.searchParams.set('internalToken', internalToken);
  }
  return resolved.toString();
})();

const mediaResponse = await fetch(firstMediaUrl, { headers: { Accept: '*/*' } });
if (!mediaResponse.ok) {
  console.error(`First media URI failed: HTTP ${mediaResponse.status}`);
  process.exit(1);
}

const mediaContentType = mediaResponse.headers.get('content-type') || '';
const mediaRaw = await mediaResponse.arrayBuffer();
const mediaBuffer = new Uint8Array(mediaRaw);
if (!mediaBuffer.byteLength) {
  console.error('First media URI returned empty body');
  process.exit(1);
}

const mediaText = new TextDecoder().decode(mediaBuffer.slice(0, 2_000_000));
const mediaIsPlaylist =
  mediaText.trimStart().startsWith('#EXTM3U') || /mpegurl/i.test(mediaContentType);

let firstSegmentUrl = '';
let firstSegmentBytes = 0;
if (mediaIsPlaylist) {
  const segmentLine = mediaText
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !line.startsWith('#'));

  if (!segmentLine) {
    console.error('Nested media playlist has no segment URI');
    process.exit(1);
  }

  const resolvedSegmentUrl = new URL(segmentLine, firstMediaUrl);
  if (internalToken && !resolvedSegmentUrl.searchParams.get('internalToken')) {
    resolvedSegmentUrl.searchParams.set('internalToken', internalToken);
  }
  firstSegmentUrl = resolvedSegmentUrl.toString();

  const segmentResponse = await fetch(firstSegmentUrl, {
    headers: { Accept: '*/*', Range: 'bytes=0-4095' },
  });
  if (!segmentResponse.ok) {
    console.error(`First segment request failed: HTTP ${segmentResponse.status}`);
    process.exit(1);
  }

  const segmentBuffer = new Uint8Array(await segmentResponse.arrayBuffer());
  if (!segmentBuffer.byteLength) {
    console.error('First segment response is empty');
    process.exit(1);
  }
  firstSegmentBytes = segmentBuffer.byteLength;
}

console.log(`[PASS] ${type.toUpperCase()} ${id}`);
console.log(`stream endpoint: ${streamEndpointWithToken}`);
console.log(`playlist: ${proxiedPlaylistUrl}`);
console.log(`first media uri: ${firstMediaUrl}`);
console.log(`first media bytes: ${mediaBuffer.byteLength}`);
if (firstSegmentUrl) {
  console.log(`first segment uri: ${firstSegmentUrl}`);
  console.log(`first segment bytes: ${firstSegmentBytes}`);
}
