#!/usr/bin/env node

import { createServer } from 'node:http';

const backendBase = (
  process.env.SECURITY_E2E_BASE_URL ||
  process.argv[2] ||
  'http://127.0.0.1:3002'
).replace(/\/+$/, '');
const fixturePort = Number(process.env.SECURITY_E2E_FIXTURE_PORT || 3111);
const fixtureBind = process.env.SECURITY_E2E_FIXTURE_BIND || '127.0.0.1';
const fixtureHost = process.env.SECURITY_E2E_FIXTURE_HOST || '127.0.0.1';
const previewFileKey = process.env.SECURITY_E2E_PREVIEW_FILE_KEY || 'movie:550';
const previewFileName = process.env.SECURITY_E2E_PREVIEW_FILE || 'thumb.jpg';
const previewFileExpectedBytes = process.env.SECURITY_E2E_PREVIEW_FILE_EXPECTED_BYTES
  ? Number(process.env.SECURITY_E2E_PREVIEW_FILE_EXPECTED_BYTES)
  : null;
const segmentBytes = Buffer.from('fixture-ts-segment');
const mediaBytes = Buffer.from('fixture-media-bytes');
const imageBytes = Buffer.from('fixture-preview-image');

const fixtureServer = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);

  if (path === '/hls/master.m3u8') {
    response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
    response.end('#EXTM3U\n#EXTINF:1,\n/fixtures/segment.ts\n');
    return;
  }

  if (path === '/fixtures/segment.ts') {
    response.writeHead(200, {
      'content-type': 'video/mp2t',
      'content-length': String(segmentBytes.length),
    });
    response.end(segmentBytes);
    return;
  }

  if (path === '/media/file.mp4') {
    response.writeHead(200, {
      'content-type': 'video/mp4',
      'content-length': String(mediaBytes.length),
    });
    response.end(mediaBytes);
    return;
  }

  if (path === '/preview/thumb.vtt') {
    response.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8' });
    response.end('WEBVTT\n\n00:00.000 --> 00:01.000\n./thumb.jpg#xywh=0,0,10,10\n');
    return;
  }

  if (path === '/preview/thumb.jpg') {
    response.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-length': String(imageBytes.length),
    });
    response.end(imageBytes);
    return;
  }

  if (path === '/files/movie:550/thumb.jpg') {
    response.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-length': String(imageBytes.length),
    });
    response.end(imageBytes);
    return;
  }

  response.writeHead(404);
  response.end('not found');
});

const request = async (path, init = {}) => fetch(`${backendBase}${path}`, init);

const readBodyOrThrow = async (response, label) => {
  if (response.ok) return response;
  const body = await response.text().catch(() => '');
  throw new Error(`${label}: HTTP ${response.status}: ${body.slice(0, 240)}`);
};

const issueProxyUrl = async (kind, url, resource = '') => {
  const response = await request('/api/proxy/capability', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, url, ...(resource ? { resource } : {}) }),
  });
  await readBodyOrThrow(response, `${kind} capability`);
  const payload = await response.json();
  if (typeof payload?.url !== 'string') {
    throw new Error(`${kind} capability: missing proxy URL`);
  }
  return payload.url;
};

await new Promise((resolve, reject) => {
  fixtureServer.once('error', reject);
  fixtureServer.listen(fixturePort, fixtureBind, resolve);
});

const fixtureBase = `http://${fixtureHost}:${fixturePort}`;

try {
  const hlsUrl = await issueProxyUrl('m3u8', `${fixtureBase}/hls/master.m3u8`);
  const manifestResponse = await readBodyOrThrow(await fetch(hlsUrl), 'm3u8 manifest');
  const manifest = await manifestResponse.text();
  const segmentLine = manifest
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !line.startsWith('#'));
  if (!segmentLine || !segmentLine.includes('/api/m3u8-proxy')) {
    throw new Error('m3u8 manifest: segment URI was not rewritten');
  }

  const segmentResponse = await readBodyOrThrow(
    await fetch(new URL(segmentLine, hlsUrl)),
    'rewritten segment'
  );
  const receivedSegment = Buffer.from(await segmentResponse.arrayBuffer());
  if (!receivedSegment.equals(segmentBytes)) {
    throw new Error('rewritten segment: body mismatch');
  }
  console.log('m3u8 manifest + segment: PASS');

  const mediaUrl = await issueProxyUrl('media', `${fixtureBase}/media/file.mp4`);
  const mediaResponse = await readBodyOrThrow(await fetch(mediaUrl), 'media proxy');
  const receivedMedia = Buffer.from(await mediaResponse.arrayBuffer());
  if (!receivedMedia.equals(mediaBytes)) {
    throw new Error('media proxy: body mismatch');
  }

  const headResponse = await readBodyOrThrow(
    await fetch(mediaUrl, { method: 'HEAD' }),
    'media proxy HEAD'
  );
  const headContentLength = headResponse.headers.get('content-length');
  if (headContentLength !== String(mediaBytes.length)) {
    throw new Error(
      `media proxy HEAD: content-length mismatch (expected ${mediaBytes.length}, got ${headContentLength})`
    );
  }
  console.log('media bytes + HEAD: PASS');

  const previewFileUrl = await issueProxyUrl(
    'preview-file',
    '',
    `${previewFileKey}|${previewFileName}`
  );
  const previewFileResponse = await readBodyOrThrow(await fetch(previewFileUrl), 'preview file');
  const receivedPreviewFile = Buffer.from(await previewFileResponse.arrayBuffer());
  if (
    previewFileExpectedBytes !== null &&
    receivedPreviewFile.length !== previewFileExpectedBytes
  ) {
    throw new Error(
      `preview file: byte length mismatch (expected ${previewFileExpectedBytes}, got ${receivedPreviewFile.length})`
    );
  }
  if (!receivedPreviewFile.length) {
    throw new Error('preview file: empty body');
  }
  if (
    !previewFileExpectedBytes &&
    !previewFileResponse.headers.get('content-type')?.startsWith('image/')
  ) {
    throw new Error('preview file: expected image content-type');
  }
  console.log('preview file bytes: PASS');

  const vttUrl = await issueProxyUrl('preview', `${fixtureBase}/preview/thumb.vtt`);
  const vttResponse = await readBodyOrThrow(await fetch(vttUrl), 'preview VTT');
  const vtt = await vttResponse.text();
  const imageLine = vtt
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !line.startsWith('WEBVTT') && !line.includes('-->'));
  if (!imageLine || !imageLine.includes('/api/preview-proxy')) {
    throw new Error('preview VTT: image URI was not rewritten');
  }

  const imageResponse = await readBodyOrThrow(
    await fetch(new URL(imageLine, vttUrl)),
    'preview image'
  );
  const receivedImage = Buffer.from(await imageResponse.arrayBuffer());
  if (!receivedImage.equals(imageBytes)) {
    throw new Error('preview image: body mismatch');
  }
  console.log('VTT rewrite + preview image: PASS');

  console.log('proxy playback fixture passed');
} finally {
  await new Promise(resolve => fixtureServer.close(resolve));
}
