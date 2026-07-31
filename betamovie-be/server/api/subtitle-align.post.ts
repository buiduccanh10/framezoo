import {
  createError,
  defineEventHandler,
  readMultipartFormData,
} from 'h3';

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_VTT_BYTES = 2 * 1024 * 1024;

function copyToArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function getMoonshineServiceUrl() {
  return (
    process.env.MOONSHINE_SERVICE_URL?.trim() ||
    'http://moonshine-service:8000'
  ).replace(/\/+$/, '');
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
  const languagePart = parts?.find(part => part.name === 'language');
  const audioStartPart = parts?.find(part => part.name === 'audioStartMs');

  if (!audioPart?.data || !vttPart?.data) {
    throw createError({
      statusCode: 400,
      statusMessage: 'audio and vtt are required',
    });
  }
  if (audioPart.data.byteLength > MAX_AUDIO_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: 'audio is too large',
    });
  }
  if (vttPart.data.byteLength > MAX_VTT_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: 'subtitle is too large',
    });
  }

  const body = new FormData();
  body.append(
    'audio',
    new Blob([copyToArrayBuffer(audioPart.data)], {
      type: audioPart.type || 'audio/wav',
    }),
    audioPart.filename || 'capture.wav',
  );
  body.append(
    'vtt',
    new Blob([copyToArrayBuffer(vttPart.data)], {
      type: 'text/vtt',
    }),
    vttPart.filename || 'subtitle.vtt',
  );
  body.append(
    'language',
    languagePart?.data
      ? Buffer.from(languagePart.data).toString('utf8').slice(0, 16)
      : 'en',
  );
  body.append(
    'audio_start_ms',
    audioStartPart?.data
      ? Buffer.from(audioStartPart.data).toString('utf8').slice(0, 16)
      : '0',
  );

  const internalToken = process.env.INTERNAL_API_TOKEN?.trim();
  const response = await fetch(`${getMoonshineServiceUrl()}/v1/align`, {
    method: 'POST',
    headers: internalToken ? { 'x-internal-token': internalToken } : undefined,
    body,
    signal: AbortSignal.timeout(
      Number(process.env.MOONSHINE_TIMEOUT_MS) || 120_000,
    ),
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
