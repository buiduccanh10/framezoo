#!/usr/bin/env node

/**
 * End-to-end check for Vidlink provider:
 * 1) backend stream endpoint returns one or more streams
 * 2) file streams proxy non-empty media bytes
 * 3) HLS streams proxy a valid manifest and playable first segment
 *
 * Usage:
 *   node scripts/e2e-vidlink.mjs --type movie --id 550
 *   node scripts/e2e-vidlink.mjs --type tv --id 94997 --season 1 --episode 1
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
    ? `${backendBase}/api/embed/api/streams/vidlink/movie/${encodeURIComponent(id)}`
    : `${backendBase}/api/embed/api/streams/vidlink/tv/${encodeURIComponent(id)}/${season}/${episode}`;

const streamEndpointWithToken = internalToken
  ? `${streamEndpoint}?internalToken=${encodeURIComponent(internalToken)}`
  : streamEndpoint;

const withToken = rawUrl => {
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
    .find(line => line && !line.startsWith('#') && !line.startsWith('<'));

const getContentType = response =>
  response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() || '';

const isTextualContentType = contentType =>
  /^(?:text\/|application\/(?:json|javascript|xml|xhtml\+xml)|image\/svg\+xml)/i.test(
    contentType
  );

const sampleText = bytes =>
  new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.slice(0, 256))
    .split('\0')
    .join('')
    .trim()
    .toLowerCase();

const looksLikeTextPayload = bytes => {
  const sample = sampleText(bytes);
  if (!sample) return false;

  return (
    sample.startsWith('<!doctype') ||
    sample.startsWith('<html') ||
    sample.startsWith('<?xml') ||
    sample.startsWith('{"') ||
    sample.startsWith('{ "') ||
    sample.startsWith('[') ||
    sample.includes('<html') ||
    sample.includes('access denied') ||
    sample.includes('forbidden') ||
    sample.includes('stream unavailable')
  );
};

const looksLikeTransportStream = bytes => {
  if (!bytes.length) return false;
  if (bytes.length < 188) return bytes[0] === 0x47;

  const offsets = [0, 188, 376].filter(offset => offset < bytes.length);
  return offsets.length >= 2 && offsets.every(offset => bytes[offset] === 0x47);
};

const looksLikeIsobmff = bytes => {
  if (bytes.length < 8) return false;

  const markers = new Set(['ftyp', 'moof', 'styp', 'sidx', 'mdat']);
  for (let offset = 0; offset <= Math.min(bytes.length - 8, 64); offset += 1) {
    const marker = String.fromCharCode(
      bytes[offset + 4] || 0,
      bytes[offset + 5] || 0,
      bytes[offset + 6] || 0,
      bytes[offset + 7] || 0
    );
    if (markers.has(marker)) {
      return true;
    }
  }

  return false;
};

const isBinaryMediaResponse = async response => {
  if (!response?.ok) return false;

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) return false;

  const contentType = getContentType(response);
  if (contentType && isTextualContentType(contentType)) return false;
  if (looksLikeTextPayload(bytes)) return false;

  return (
    looksLikeTransportStream(bytes) ||
    looksLikeIsobmff(bytes) ||
    !contentType ||
    /^(?:video\/|audio\/|application\/(?:octet-stream|mp4|mp2t))/i.test(contentType)
  );
};

const streamResponse = await fetch(streamEndpointWithToken, {
  headers: { Accept: 'application/json' },
});

if (!streamResponse.ok) {
  console.error(`HTTP ${streamResponse.status} from ${streamEndpointWithToken}`);
  process.exit(1);
}

const streamPayload = await streamResponse.json().catch(() => null);
const returnedStreams = Array.isArray(streamPayload?.streams) ? streamPayload.streams : [];
if (!streamPayload?.success || !streamPayload?.count || !returnedStreams.length) {
  console.error('No playable Vidlink stream returned from backend provider');
  console.error(JSON.stringify(streamPayload));
  process.exit(1);
}

let verified = null;

for (const stream of returnedStreams) {
  const candidateUrl = withToken(String(stream?.url || ''));
  if (!candidateUrl) continue;

  if (stream?.streamType === 'file') {
    const mediaResponse = await fetch(candidateUrl, {
      headers: { Accept: '*/*', Range: 'bytes=0-65535' },
    }).catch(() => null);

    if (!(await isBinaryMediaResponse(mediaResponse))) {
      continue;
    }

    verified = {
      mode: 'file',
      quality: String(stream?.quality || ''),
      proxiedUrl: candidateUrl,
      contentType: getContentType(mediaResponse),
    };
    break;
  }

  const playlistResponse = await fetch(candidateUrl, {
    headers: { Accept: '*/*' },
  }).catch(() => null);
  if (!playlistResponse?.ok) {
    continue;
  }

  const playlistText = await playlistResponse.text();
  if (!playlistText.trimStart().startsWith('#EXTM3U')) {
    continue;
  }

  const firstLine = firstMediaLine(playlistText);
  if (!firstLine) {
    continue;
  }

  let segmentUrl = withToken(new URL(firstLine, candidateUrl).toString());
  if (/\.m3u8(?:$|[?#])/i.test(segmentUrl)) {
    const childResponse = await fetch(segmentUrl, {
      headers: { Accept: '*/*' },
    }).catch(() => null);
    if (!childResponse?.ok) {
      continue;
    }

    const childText = await childResponse.text();
    if (!childText.trimStart().startsWith('#EXTM3U')) {
      continue;
    }

    const childLine = firstMediaLine(childText);
    if (!childLine) {
      continue;
    }

    segmentUrl = withToken(new URL(childLine, segmentUrl).toString());
  }

  const segmentResponse = await fetch(segmentUrl, {
    headers: { Accept: '*/*', Range: 'bytes=0-65535' },
  }).catch(() => null);
  if (!(await isBinaryMediaResponse(segmentResponse))) {
    continue;
  }

  verified = {
    mode: 'hls',
    quality: String(stream?.quality || ''),
    proxiedUrl: candidateUrl,
    segmentUrl,
    contentType: getContentType(segmentResponse),
  };
  break;
}

if (!verified) {
  console.error('No playable Vidlink stream survived proxy validation');
  console.error(JSON.stringify(streamPayload));
  process.exit(1);
}

console.log(`[PASS] ${type.toUpperCase()} ${id}`);
console.log(`stream endpoint: ${streamEndpointWithToken}`);
console.log(`streams returned: ${returnedStreams.length}`);
console.log(`verified mode: ${verified.mode}`);
console.log(`verified quality: ${verified.quality || 'n/a'}`);
console.log(`proxied url: ${verified.proxiedUrl}`);
if (verified.segmentUrl) {
  console.log(`segment url: ${verified.segmentUrl}`);
}
console.log(`content-type: ${verified.contentType || 'n/a'}`);
