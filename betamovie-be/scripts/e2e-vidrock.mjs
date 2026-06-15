#!/usr/bin/env node

/**
 * End-to-end check for Vidrock provider:
 * 1) backend stream endpoint returns a proxied playlist URL
 * 2) proxied playlist is a valid M3U8 manifest
 * 3) first media URI is fetchable
 * 4) first segment URI is fetchable and non-empty
 *
 * Usage:
 *   node scripts/e2e-vidrock.mjs --type movie --id 550
 *   node scripts/e2e-vidrock.mjs --type tv --id 1399 --season 1 --episode 1
 */

const args = process.argv.slice(2);

const getArg = key => {
  const index = args.indexOf(`--${key}`);
  return index === -1 ? null : (args[index + 1] ?? null);
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
    ? `${backendBase}/api/embed/api/streams/vidrock/movie/${encodeURIComponent(id)}`
    : `${backendBase}/api/embed/api/streams/vidrock/tv/${encodeURIComponent(id)}/${season}/${episode}`;

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

function firstMediaLine(manifest) {
  return manifest
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !line.startsWith('#') && !line.startsWith('<'));
}

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

const proxiedPlaylistUrl = withToken(proxiedUrl);
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

const mediaLine = firstMediaLine(playlistText);
if (!mediaLine) {
  console.error('No media URI line found in playlist');
  process.exit(1);
}

const firstMediaUrl = withToken(new URL(mediaLine, proxiedPlaylistUrl).toString());
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

const segmentLine = mediaIsPlaylist ? firstMediaLine(mediaText) : mediaLine;
if (!segmentLine) {
  console.error('Nested media playlist has no segment URI');
  process.exit(1);
}

const firstSegmentUrl = withToken(
  new URL(segmentLine, mediaIsPlaylist ? firstMediaUrl : proxiedPlaylistUrl).toString()
);
const segmentResponse = await fetch(firstSegmentUrl, {
  headers: { Accept: '*/*', Range: 'bytes=0-4095' },
});
if (!segmentResponse.ok) {
  console.error(`First segment request failed: HTTP ${segmentResponse.status}`);
  process.exit(1);
}

const segmentBuffer = await segmentResponse.arrayBuffer();
if (!segmentBuffer.byteLength) {
  console.error('First segment response is empty');
  process.exit(1);
}

console.log(`[PASS] ${type.toUpperCase()} ${id}`);
console.log(`stream endpoint: ${streamEndpointWithToken}`);
console.log(`playlist: ${proxiedPlaylistUrl}`);
console.log(`first media uri: ${firstMediaUrl}`);
console.log(`first media bytes: ${mediaBuffer.byteLength}`);
console.log(`first segment uri: ${firstSegmentUrl}`);
console.log(`first segment content-type: ${segmentResponse.headers.get('content-type') || ''}`);
console.log(`first segment bytes: ${segmentBuffer.byteLength}`);
