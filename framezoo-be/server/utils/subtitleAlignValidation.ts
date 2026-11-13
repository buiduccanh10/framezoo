import { Buffer } from 'node:buffer';
import type { Readable } from 'node:stream';
import { createError, getHeader, readMultipartFormData, type H3Event } from 'h3';

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_VTT_BYTES = 2 * 1024 * 1024;
export const MAX_BATCH_SUBTITLES_BYTES = MAX_VTT_BYTES * 2 + 8 * 1024;
export const MAX_ALIGNMENT_WINDOWS = 6;
export const MAX_ALIGNMENT_TOTAL_AUDIO_BYTES = 14 * 1024 * 1024;
export const MAX_ALIGNMENT_SPEECH_BYTES = 512 * 1024;
export const MAX_MULTIPART_REQUEST_BYTES =
  MAX_ALIGNMENT_TOTAL_AUDIO_BYTES + MAX_BATCH_SUBTITLES_BYTES + 2 * 1024 * 1024;

export const MAX_WINDOW_START_MS = 86_400_000;
export const MIN_WINDOW_DURATION_MS = 500;
export const MAX_WINDOW_DURATION_MS = 120_000;
export const MAX_SPEECH_INTERVALS_PER_WINDOW = 500;
export const MAX_SPEECH_INTERVAL_SPAN_MS = 120_000;
export const MAX_SPEECH_INTERVAL_SLACK_MS = 5_000;

export interface SpeechIntervalInput {
  startMs: number;
  endMs: number;
}

type NodeReqWithRawBody = Readable & {
  headers?: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
  body?: unknown;
  destroyed?: boolean;
};

/**
 * Enforce an explicit byte cap on incoming multipart alignment uploads before h3
 * buffers the entire request body into memory.
 */
export async function readBoundedMultipartFormData(
  event: H3Event,
  maxBodyBytes = MAX_MULTIPART_REQUEST_BYTES
) {
  const rawLength = getHeader(event, 'content-length');
  if (rawLength !== undefined) {
    const trimmed = rawLength.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'invalid Content-Length header',
      });
    }
    const contentLength = Number(trimmed);
    if (!Number.isSafeInteger(contentLength) || contentLength > maxBodyBytes) {
      throw createError({
        statusCode: 413,
        statusMessage: 'alignment request is too large',
      });
    }
  }

  const req = event.node?.req as NodeReqWithRawBody | undefined;
  const cachedBody = (event as unknown as { _requestBody?: unknown })._requestBody;
  if (Buffer.isBuffer(cachedBody) && cachedBody.byteLength > maxBodyBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: 'alignment request is too large',
    });
  }

  if (req && typeof req.on === 'function' && !req.rawBody && !req.body && !cachedBody) {
    const hasLength = Number.parseInt(String(req.headers?.['content-length'] || ''), 10) > 0;
    const isChunked = /\bchunked\b/i.test(String(req.headers?.['transfer-encoding'] ?? ''));
    if (hasLength || isChunked) {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        receivedBytes += buf.byteLength;
        if (receivedBytes > maxBodyBytes) {
          req.destroy();
          throw createError({
            statusCode: 413,
            statusMessage: 'alignment request is too large',
          });
        }
        chunks.push(buf);
      }
      req.rawBody = Buffer.concat(chunks);
    }
  }

  return await readMultipartFormData(event);
}

export function validateSpeechIntervalList(
  payload: unknown,
  bounds?: { minStartMs: number; maxEndMs: number }
): SpeechIntervalInput[] {
  if (!Array.isArray(payload)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'speechIntervals must be an array',
    });
  }
  if (payload.length > MAX_SPEECH_INTERVALS_PER_WINDOW) {
    throw createError({
      statusCode: 400,
      statusMessage: 'too many speech intervals',
    });
  }

  const parsed: SpeechIntervalInput[] = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object') {
      throw createError({
        statusCode: 400,
        statusMessage: 'speech interval must be an object',
      });
    }
    const candidate = item as { startMs?: unknown; endMs?: unknown };
    const startMs = candidate.startMs;
    const endMs = candidate.endMs;
    if (
      typeof startMs !== 'number' ||
      typeof endMs !== 'number' ||
      !Number.isInteger(startMs) ||
      !Number.isInteger(endMs) ||
      startMs < 0 ||
      endMs <= startMs ||
      endMs > MAX_WINDOW_START_MS + MAX_SPEECH_INTERVAL_SPAN_MS ||
      endMs - startMs > MAX_SPEECH_INTERVAL_SPAN_MS
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: 'speech interval must contain valid startMs and endMs',
      });
    }
    if (bounds && (startMs < bounds.minStartMs || endMs > bounds.maxEndMs)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'speech interval falls outside alignment window bounds',
      });
    }
    parsed.push({ startMs, endMs });
  }
  return parsed;
}

export function parseBoundedWindowStarts(rawJson: string, expectedCount: number): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'windowStartsMs must be valid JSON',
    });
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== expectedCount ||
    parsed.some(
      value =>
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > MAX_WINDOW_START_MS
    )
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'invalid alignment window metadata',
    });
  }
  return parsed as number[];
}

export function parseBoundedWindowDurations(rawJson: string, expectedCount: number): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'windowDurationsMs must be valid JSON',
    });
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== expectedCount ||
    parsed.some(
      value =>
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < MIN_WINDOW_DURATION_MS ||
        value > MAX_WINDOW_DURATION_MS
    )
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'invalid alignment window durations',
    });
  }
  return parsed as number[];
}

export function parseBoundedSpeechIntervalWindows(
  rawJson: string,
  starts: number[],
  durations: number[]
): SpeechIntervalInput[][] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'speechIntervals must be valid JSON',
    });
  }
  if (!Array.isArray(parsed) || parsed.length !== starts.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'invalid speech window metadata',
    });
  }
  return parsed.map((windowItems, idx) =>
    validateSpeechIntervalList(windowItems, {
      minStartMs: Math.max(0, starts[idx] - MAX_SPEECH_INTERVAL_SLACK_MS),
      maxEndMs: starts[idx] + durations[idx] + MAX_SPEECH_INTERVAL_SLACK_MS,
    })
  );
}
