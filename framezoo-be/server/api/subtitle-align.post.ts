import {
  createError,
  defineEventHandler,
  getHeader,
  getRequestIP,
  readMultipartFormData,
} from 'h3';

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_VTT_BYTES = 2 * 1024 * 1024;
const MAX_BATCH_SUBTITLES_BYTES = MAX_VTT_BYTES * 2 + 8 * 1024;
const MAX_ALIGNMENT_WINDOWS = 6;
const MAX_ALIGNMENT_TOTAL_AUDIO_BYTES = 14 * 1024 * 1024;
const MAX_ALIGNMENT_SPEECH_BYTES = 512 * 1024;

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
  const parts = await readMultipartFormData(event);
  const audioPart = parts?.find(part => part.name === 'audio');
  const audioParts = parts?.filter(part => part.name === 'audio' && part.data) || [];
  const vttPart = parts?.find(part => part.name === 'vtt');
  const subtitlesPart = parts?.find(part => part.name === 'subtitles');
  const speechIntervalsPart = parts?.find(part => part.name === 'speechIntervals');
  const languagePart = parts?.find(part => part.name === 'language');
  const audioStartPart = parts?.find(part => part.name === 'audioStartMs');
  const audioEndPart = parts?.find(part => part.name === 'audioEndMs');
  const windowStartsPart = parts?.find(part => part.name === 'windowStartsMs');
  const windowDurationsPart = parts?.find(part => part.name === 'windowDurationsMs');
  const hasAudio = audioParts.length > 0;
  const hasSpeechIntervals = Boolean(speechIntervalsPart?.data?.byteLength);

  if ((!hasAudio && !hasSpeechIntervals) || (!vttPart?.data && !subtitlesPart?.data)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'audio or speechIntervals and vtt or subtitles are required',
    });
  }
  if (hasAudio && hasSpeechIntervals) {
    throw createError({
      statusCode: 400,
      statusMessage: 'audio and speechIntervals cannot be sent together',
    });
  }
  if (
    speechIntervalsPart?.data &&
    speechIntervalsPart.data.byteLength > MAX_ALIGNMENT_SPEECH_BYTES
  ) {
    throw createError({
      statusCode: 413,
      statusMessage: 'speech intervals are too large',
    });
  }

  const isWindowAlignment = Boolean(windowStartsPart?.data);
  if (isWindowAlignment) {
    if (!subtitlesPart?.data || (!hasAudio && !hasSpeechIntervals)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'alignment windows and subtitles are required',
      });
    }

    let windowCount = audioParts.length;
    if (!hasAudio) {
      try {
        const intervals = JSON.parse(Buffer.from(speechIntervalsPart!.data).toString('utf8'));
        windowCount = Array.isArray(intervals) ? intervals.length : 0;
      } catch {
        throw createError({
          statusCode: 400,
          statusMessage: 'speechIntervals must be valid JSON',
        });
      }
    }
    let windowStarts: unknown;
    try {
      windowStarts = JSON.parse(
        windowStartsPart?.data ? Buffer.from(windowStartsPart.data).toString('utf8') : 'null'
      );
    } catch {
      throw createError({
        statusCode: 400,
        statusMessage: 'windowStartsMs must be valid JSON',
      });
    }
    if (
      windowCount < 1 ||
      windowCount > MAX_ALIGNMENT_WINDOWS ||
      !Array.isArray(windowStarts) ||
      windowStarts.length !== windowCount ||
      windowStarts.some(value => typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: 'invalid alignment window metadata',
      });
    }
    if (hasSpeechIntervals) {
      if (!windowDurationsPart?.data) {
        throw createError({
          statusCode: 400,
          statusMessage: 'windowDurationsMs is required for speechIntervals',
        });
      }
      let durations: unknown;
      try {
        durations = JSON.parse(Buffer.from(windowDurationsPart.data).toString('utf8'));
      } catch {
        throw createError({
          statusCode: 400,
          statusMessage: 'windowDurationsMs must be valid JSON',
        });
      }
      if (
        !Array.isArray(durations) ||
        durations.length !== windowCount ||
        durations.some(value => typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
      ) {
        throw createError({
          statusCode: 400,
          statusMessage: 'invalid alignment window durations',
        });
      }
    }

    const totalAudioBytes = audioParts.reduce(
      (total, part) => total + (part.data?.byteLength || 0),
      0
    );
    if (
      hasAudio &&
      (totalAudioBytes > MAX_ALIGNMENT_TOTAL_AUDIO_BYTES ||
        audioParts.some(part => (part.data?.byteLength || 0) > MAX_AUDIO_BYTES))
    ) {
      throw createError({
        statusCode: 413,
        statusMessage: 'alignment audio is too large',
      });
    }
  } else if (!audioPart?.data || audioPart.data.byteLength > MAX_AUDIO_BYTES) {
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
  if (isWindowAlignment && hasAudio) {
    for (const [index, part] of audioParts.entries()) {
      body.append(
        'audio',
        new Blob([copyToArrayBuffer(part.data)], {
          type: part.type || 'audio/wav',
        }),
        part.filename || `capture-${index}.wav`
      );
    }
  } else if (audioPart?.data) {
    body.append(
      'audio',
      new Blob([copyToArrayBuffer(audioPart.data)], {
        type: audioPart.type || 'audio/wav',
      }),
      audioPart.filename || 'capture.wav'
    );
  }
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
  if (speechIntervalsPart?.data) {
    body.append('speech_intervals', Buffer.from(speechIntervalsPart.data).toString('utf8'));
  }
  body.append(
    'language',
    languagePart?.data ? Buffer.from(languagePart.data).toString('utf8').slice(0, 16) : 'en'
  );
  body.append(
    'audio_start_ms',
    audioStartPart?.data ? Buffer.from(audioStartPart.data).toString('utf8').slice(0, 16) : '0'
  );
  if (audioEndPart?.data) {
    body.append('audio_end_ms', Buffer.from(audioEndPart.data).toString('utf8').slice(0, 16));
  }
  if (isWindowAlignment) {
    body.append(
      'window_starts_ms',
      windowStartsPart?.data ? Buffer.from(windowStartsPart.data).toString('utf8') : '[]'
    );
    if (windowDurationsPart?.data) {
      body.append('window_durations_ms', Buffer.from(windowDurationsPart.data).toString('utf8'));
    }
  }

  const internalToken = process.env.INTERNAL_API_TOKEN?.trim();
  const clientIp =
    getRequestIP(event, { xForwardedFor: true }) ||
    getHeader(event, 'x-forwarded-for') ||
    '127.0.0.1';

  const headers: Record<string, string> = {
    'x-forwarded-for': clientIp,
  };
  if (internalToken) {
    headers['x-internal-token'] = internalToken;
  }

  const endpoint = isWindowAlignment
    ? '/v1/align-windows'
    : subtitlesPart?.data
      ? '/v1/align-batch'
      : '/v1/align';
  const response = await fetch(`${getMoonshineServiceUrl()}${endpoint}`, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(Number(process.env.MOONSHINE_TIMEOUT_MS) || 300_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    let statusMessage = 'Moonshine alignment failed';
    try {
      const json = JSON.parse(detail);
      if (json.detail) statusMessage = json.detail;
    } catch {
      if (detail) statusMessage = detail.slice(0, 500);
    }

    throw createError({
      statusCode: response.status >= 500 && response.status !== 503 ? 502 : response.status,
      statusMessage,
    });
  }

  return await response.json();
});
