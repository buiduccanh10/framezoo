#!/usr/bin/env node

/**
 * End-to-end check for KKPhim inserted ad-video filtering:
 * 1) backend stream endpoint returns a proxied playlist URL
 * 2) upstream media playlist contains a contiguous convertv* ad block
 * 3) proxied media playlist strips that ad block
 * 4) first segment after the stripped ad block is still fetchable
 *
 * Usage:
 *   node scripts/e2e-kkphim-ad-filter.mjs --type movie --id 550
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
    ? `${backendBase}/api/embed/api/streams/kkphim/movie/${encodeURIComponent(id)}`
    : `${backendBase}/api/embed/api/streams/kkphim/tv/${encodeURIComponent(id)}/${season}/${episode}`;

const streamEndpointWithToken = internalToken
  ? `${streamEndpoint}?internalToken=${encodeURIComponent(internalToken)}`
  : streamEndpoint;

const addInternalToken = rawUrl => {
  if (!internalToken) return rawUrl;
  const parsed = new URL(rawUrl);
  if (!parsed.searchParams.get('internalToken')) {
    parsed.searchParams.set('internalToken', internalToken);
  }
  return parsed.toString();
};

const firstMediaLine = manifest =>
  manifest
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !line.startsWith('#'));

const decodeMaybe = value => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const isKkPhimAdSegment = value => {
  const normalized = decodeMaybe(value);
  return (
    /(?:^|\/)convertv\d*\//i.test(normalized) ||
    /(?:^|\/)v\d+\/[0-9a-f]{16,}\/segment_\d+\.ts(?:$|[?#])/i.test(normalized)
  );
};

const parsePlaylistEntries = manifest => {
  const entries = [];
  let currentTime = 0;
  let duration = null;

  for (const line of manifest.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('#EXTINF:')) {
      duration = Number(trimmed.slice('#EXTINF:'.length).split(',')[0]);
      continue;
    }

    if (trimmed.startsWith('#')) {
      continue;
    }

    const entryDuration = Number.isFinite(duration) ? duration : 0;
    entries.push({
      startSec: currentTime,
      durationSec: entryDuration,
      url: trimmed,
    });
    currentTime += entryDuration;
    duration = null;
  }

  return entries;
};

const groupContiguousAdBlocks = entries => {
  const blocks = [];
  let current = [];
  let lastIndex = -2;

  entries.forEach((entry, index) => {
    if (!isKkPhimAdSegment(entry.url)) {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
      return;
    }

    if (index !== lastIndex + 1 && current.length) {
      blocks.push(current);
      current = [];
    }

    current.push({ ...entry, index });
    lastIndex = index;
  });

  if (current.length) {
    blocks.push(current);
  }

  return blocks;
};

const streamResponse = await fetch(streamEndpointWithToken, {
  headers: { Accept: 'application/json' },
});

if (!streamResponse.ok) {
  console.error(`HTTP ${streamResponse.status} from ${streamEndpointWithToken}`);
  process.exit(1);
}

const streamPayload = await streamResponse.json().catch(() => null);
const proxiedMasterUrl = streamPayload?.streams?.[0]?.url;
if (!streamPayload?.success || !streamPayload?.count || typeof proxiedMasterUrl !== 'string') {
  console.error('No playable KKPhim stream returned from backend provider');
  console.error(JSON.stringify(streamPayload));
  process.exit(1);
}

const proxiedMasterWithToken = addInternalToken(proxiedMasterUrl);
const masterResponse = await fetch(proxiedMasterWithToken, { headers: { Accept: '*/*' } });
if (!masterResponse.ok) {
  console.error(`Master playlist request failed: HTTP ${masterResponse.status}`);
  process.exit(1);
}

const masterPlaylist = await masterResponse.text();
if (!masterPlaylist.trimStart().startsWith('#EXTM3U')) {
  console.error('Master playlist is not valid M3U8');
  process.exit(1);
}

const proxiedMediaLine = firstMediaLine(masterPlaylist);
if (!proxiedMediaLine) {
  console.error('No media playlist URI found in proxied master manifest');
  process.exit(1);
}

const proxiedMediaUrl = addInternalToken(new URL(proxiedMediaLine, proxiedMasterWithToken).toString());
const proxiedMediaResponse = await fetch(proxiedMediaUrl, { headers: { Accept: '*/*' } });
if (!proxiedMediaResponse.ok) {
  console.error(`Proxied media playlist request failed: HTTP ${proxiedMediaResponse.status}`);
  process.exit(1);
}

const proxiedMediaPlaylist = await proxiedMediaResponse.text();

const rawMasterUpstream = decodeURIComponent(new URL(proxiedMasterUrl).searchParams.get('url') || '');
const rawHeaders = JSON.parse(decodeURIComponent(new URL(proxiedMasterUrl).searchParams.get('headers') || '{}'));

if (!rawMasterUpstream) {
  console.error('Unable to recover upstream master playlist URL from proxied stream');
  process.exit(1);
}

const rawMasterResponse = await fetch(rawMasterUpstream, {
  headers: rawHeaders,
});
if (!rawMasterResponse.ok) {
  console.error(`Upstream master playlist request failed: HTTP ${rawMasterResponse.status}`);
  process.exit(1);
}

const rawMasterPlaylist = await rawMasterResponse.text();
const rawMediaLine = firstMediaLine(rawMasterPlaylist);
if (!rawMediaLine) {
  console.error('No media playlist URI found in upstream master manifest');
  process.exit(1);
}

const rawMediaUrl = new URL(rawMediaLine, rawMasterUpstream).toString();
const rawMediaResponse = await fetch(rawMediaUrl, {
  headers: rawHeaders,
});
if (!rawMediaResponse.ok) {
  console.error(`Upstream media playlist request failed: HTTP ${rawMediaResponse.status}`);
  process.exit(1);
}

const rawMediaPlaylist = await rawMediaResponse.text();
const rawEntries = parsePlaylistEntries(rawMediaPlaylist);
const rawAdBlocks = groupContiguousAdBlocks(rawEntries);
const rawAdEntries = rawAdBlocks.flat();

if (!rawAdEntries.length) {
  console.error('No inserted KKPhim ad-video block found in upstream media playlist');
  process.exit(1);
}

if (parsePlaylistEntries(proxiedMediaPlaylist).some(entry => isKkPhimAdSegment(entry.url))) {
  console.error('Inserted KKPhim ad-video block still exists in proxied media playlist');
  process.exit(1);
}

const lastAdBlock = rawAdBlocks[rawAdBlocks.length - 1];
const rawLastAd = lastAdBlock[lastAdBlock.length - 1];
const firstPostAdEntry = rawEntries[rawLastAd.index + 1];

if (!firstPostAdEntry) {
  console.error('Could not determine the first content segment after the stripped ad block');
  process.exit(1);
}

const proxiedEntries = parsePlaylistEntries(proxiedMediaPlaylist);
const firstPostAdPathname = new URL(firstPostAdEntry.url, rawMediaUrl).pathname;
const firstPostAdSegment = proxiedEntries.find(entry =>
  entry.url.includes(encodeURIComponent(firstPostAdPathname)) ||
  decodeURIComponent(entry.url).includes(firstPostAdPathname)
);

if (!firstPostAdSegment) {
  console.error('Could not find the first post-ad content segment in the proxied playlist');
  process.exit(1);
}

const firstPostAdResponse = await fetch(addInternalToken(firstPostAdSegment.url), {
  headers: { Accept: '*/*', Range: 'bytes=0-4095' },
});
if (!firstPostAdResponse.ok) {
  console.error(`First post-ad segment failed: HTTP ${firstPostAdResponse.status}`);
  process.exit(1);
}

const firstPostAdBytes = await firstPostAdResponse.arrayBuffer();
if (!firstPostAdBytes.byteLength) {
  console.error('First post-ad segment returned an empty body');
  process.exit(1);
}

const formatTime = seconds => {
  const minutes = Math.floor(seconds / 60);
  const secs = (seconds - minutes * 60).toFixed(2).padStart(5, '0');
  return `${minutes}:${secs}`;
};

console.log(`[PASS] KKPhim inserted ad-video filter (${type.toUpperCase()} ${id})`);
console.log(`stream endpoint: ${streamEndpointWithToken}`);
console.log(`upstream media playlist: ${rawMediaUrl}`);
rawAdBlocks.forEach((block, index) => {
  const first = block[0];
  const last = block[block.length - 1];
  console.log(
    `removed ad block ${index + 1}: ${formatTime(first.startSec)} -> ${formatTime(last.startSec + last.durationSec)} (${block.length} segments)`
  );
});
console.log(`proxied media playlist: ${proxiedMediaUrl}`);
console.log(`first post-ad segment: ${firstPostAdSegment.url}`);
console.log(`first post-ad bytes: ${firstPostAdBytes.byteLength}`);
