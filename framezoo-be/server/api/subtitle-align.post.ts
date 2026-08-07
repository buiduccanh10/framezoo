import { createError, defineEventHandler, readMultipartFormData } from 'h3';

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_VTT_BYTES = 2 * 1024 * 1024;
const MAX_BATCH_SUBTITLES_BYTES = MAX_VTT_BYTES * 2 + 8 * 1024;

function copyToArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function getMoonshineServiceUrl() {
  return (process.env.MOONSHINE_SERVICE_URL?.trim() || 'http://moonshine-service:8000').replace(
    /\/+$/,
    ''
  );
}

export default defineEventHandler(async event => {
  if (!event.context.session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Authentication required',
    });
  }

  const parts = await readMultipartFormData(event);
  const audioPart = parts?.find(part => part.name === 'audio');
  const vttPart = parts?.find(part => part.name === 'vtt');
  const subtitlesPart = parts?.find(part => part.name === 'subtitles');
  const languagePart = parts?.find(part => part.name === 'language');
  const audioStartPart = parts?.find(part => part.name === 'audioStartMs');

  if (!audioPart?.data || (!vttPart?.data && !subtitlesPart?.data)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'audio and vtt or subtitles are required',
    });
  }
  if (audioPart.data.byteLength > MAX_AUDIO_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: 'audio is too large',
    });
  }
  if (vttPart?.data && vttPart.data.byteLength > MAX_VTT_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: 'subtitle is too large',
    });
  }
  if (subtitlesPart?.data && subtitlesPart.data.byteLength > MAX_BATCH_SUBTITLES_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: 'subtitles are too large',
    });
  }

  const body = new FormData();
  body.append(
    'audio',
    new Blob([copyToArrayBuffer(audioPart.data)], {
      type: audioPart.type || 'audio/wav',
    }),
    audioPart.filename || 'capture.wav'
  );
  if (vttPart?.data) {
    body.append(
      'vtt',
      new Blob([copyToArrayBuffer(vttPart.data)], {
        type: 'text/vtt',
      }),
      vttPart.filename || 'subtitle.vtt'
    );
  }
  if (subtitlesPart?.data) {
    body.append('subtitles', Buffer.from(subtitlesPart.data).toString('utf8'));
  }
  body.append(
    'language',
    languagePart?.data ? Buffer.from(languagePart.data).toString('utf8').slice(0, 16) : 'en'
  );
  body.append(
    'audio_start_ms',
    audioStartPart?.data ? Buffer.from(audioStartPart.data).toString('utf8').slice(0, 16) : '0'
  );

  const internalToken = process.env.INTERNAL_API_TOKEN?.trim();
  const endpoint = subtitlesPart?.data ? '/v1/align-batch' : '/v1/align';
  const response = await fetch(`${getMoonshineServiceUrl()}${endpoint}`, {
    method: 'POST',
    headers: internalToken ? { 'x-internal-token': internalToken } : undefined,
    body,
    signal: AbortSignal.timeout(Number(process.env.MOONSHINE_TIMEOUT_MS) || 300_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw createError({
      statusCode: response.status >= 500 ? 502 : response.status,
      statusMessage: detail.slice(0, 500) || 'Moonshine alignment failed',
    });
  }

  return await response.json();
});
