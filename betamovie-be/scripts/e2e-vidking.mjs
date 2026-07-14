#!/usr/bin/env node

/**
 * End-to-end check for Vidking provider:
 * 1) backend stream endpoint returns one or more quality-labelled streams
 * 2) at least one returned playlist is a valid M3U8 manifest
 * 3) first segment URI for a playable stream is fetchable and non-empty
 *
 * Usage:
 *   node scripts/e2e-vidking.mjs --type movie --id 550
 *   node scripts/e2e-vidking.mjs --type tv --id 1399 --season 1 --episode 1
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
const internalHeaders = internalToken ? { 'x-internal-token': internalToken } : {};

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

function firstMediaLine(manifest) {
  return manifest
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !line.startsWith('#') && !line.startsWith('<'));
}

const streamResponse = await fetch(streamEndpoint, {
  headers: { Accept: 'application/json', ...internalHeaders },
});

if (!streamResponse.ok) {
  console.error(`HTTP ${streamResponse.status} from ${streamEndpoint}`);
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
  .filter(Boolean);

let playablePlaylistUrl = '';
let firstSegmentUrl = '';
let segmentResponse = null;
let segmentBuffer = null;

for (const stream of returnedStreams) {
  const candidateUrl = String(stream?.url || '').trim();
  if (!candidateUrl) continue;

  const playlistResponse = await fetch(candidateUrl, { headers: { Accept: '*/*' } }).catch(
    () => null
  );
  if (!playlistResponse?.ok) {
    continue;
  }

  const playlistText = await playlistResponse.text();
  if (!playlistText.trimStart().startsWith('#EXTM3U')) {
    continue;
  }

  const segmentLine = firstMediaLine(playlistText);
  if (!segmentLine) {
    continue;
  }

  const candidateSegmentUrl = new URL(segmentLine, candidateUrl).toString();
  const candidateSegmentResponse = await fetch(candidateSegmentUrl, {
    headers: { Accept: '*/*', Range: 'bytes=0-4095' },
  }).catch(() => null);
  if (!candidateSegmentResponse?.ok) {
    continue;
  }

  const candidateSegmentBuffer = await candidateSegmentResponse.arrayBuffer();
  if (!candidateSegmentBuffer.byteLength) {
    continue;
  }

  playablePlaylistUrl = candidateUrl;
  firstSegmentUrl = candidateSegmentUrl;
  segmentResponse = candidateSegmentResponse;
  segmentBuffer = candidateSegmentBuffer;
  break;
}

if (!playablePlaylistUrl || !segmentResponse || !segmentBuffer) {
  console.error('No playable playlist returned from backend provider');
  console.error(JSON.stringify(streamPayload));
  process.exit(1);
}

console.log(`[PASS] ${type.toUpperCase()} ${id}`);
console.log(`stream endpoint: ${streamEndpoint}`);
console.log(`qualities: ${qualities.join(', ') || 'n/a'}`);
console.log(`playlist: ${playablePlaylistUrl}`);
console.log(`first segment uri: ${firstSegmentUrl}`);
console.log(`first segment content-type: ${segmentResponse.headers.get('content-type') || ''}`);
console.log(`first segment bytes: ${segmentBuffer.byteLength}`);
