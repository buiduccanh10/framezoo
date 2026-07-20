import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  assertProxyCapability,
  assertSafeUpstreamUrl,
  buildProxyRequestUrl,
  getProxyCapabilityKindForPath,
  normalizeProxyHeaders,
} from '~/utils/proxySecurity';

const ALIGN_SERVICE_URL = process.env.SUBTITLE_ALIGN_SERVICE_URL || 'http://127.0.0.1:3200';
const ALIGN_BACKEND_INTERNAL_BASE_URL =
  process.env.SUBTITLE_ALIGN_BACKEND_INTERNAL_BASE_URL || 'http://127.0.0.1:3000';
const ALIGN_SERVICE_TIMEOUT_MS = Number(process.env.SUBTITLE_ALIGN_SERVICE_TIMEOUT_MS || 300_000);
const ALIGN_SERVICE_INTERNAL_TOKEN = process.env.SUBTITLE_ALIGN_INTERNAL_TOKEN?.trim() || '';
const ALIGN_MODEL = process.env.SUBTITLE_ALIGN_MODEL || 'small';
const ALIGN_MAX_BODY_BYTES = 1_500_000;
const ALIGN_WINDOW_MS = 60_000;

const alignSchema = z.object({
  mediaKey: z.string().trim().min(1).max(300),
  sourceId: z.string().trim().min(1).max(300),
  captionId: z.string().trim().min(1).max(500),
  sourceType: z.enum(['hls', 'dash', 'file']),
  sourceUrl: z.string().trim().url().max(8192),
  sourceHeaders: z.record(z.string().max(128), z.string().max(2048)).optional().default({}),
  subtitleVtt: z.string().min(1).max(1_000_000),
  videoDurationMs: z
    .number()
    .finite()
    .positive()
    .max(24 * 60 * 60 * 1000),
  skipSegments: z
    .array(
      z.object({
        type: z.string().optional(),
        start_ms: z.number().finite().nullable().optional(),
        end_ms: z.number().finite().nullable().optional(),
      })
    )
    .max(32)
    .optional()
    .default([]),
  force: z.boolean().optional().default(false),
});

type AlignInput = z.infer<typeof alignSchema>;
type AlignWindow = {
  startMs: number;
  durationMs: number;
};
type AlignResponse = {
  offsetMs: number;
  windowOffsetsMs: number[];
  driftMs: number | null;
  confidence: 'high' | 'medium' | 'rejected';
  matchedCueCount: number;
  scores: number[];
  methods: string[];
  windows: AlignWindow[];
  model: string;
  cached?: boolean;
  reason?: string;
};

type ResolvedAlignmentSource = {
  url: string;
  headers: Record<string, string>;
};

const inFlight = new Map<string, Promise<AlignResponse>>();

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeSegment = (segment: AlignInput['skipSegments'][number]) => {
  const startMs = Number.isFinite(segment.start_ms ?? NaN)
    ? Math.max(0, segment.start_ms as number)
    : null;
  const endMs = Number.isFinite(segment.end_ms ?? NaN)
    ? Math.max(0, segment.end_ms as number)
    : null;
  return { startMs, endMs, type: segment.type || '' };
};

const movePastExcludedRange = (
  startMs: number,
  durationMs: number,
  excluded: ReturnType<typeof normalizeSegment>[],
  videoDurationMs: number
) => {
  let nextStart = startMs;
  for (let attempt = 0; attempt < excluded.length + 1; attempt += 1) {
    const range = excluded.find(
      ({ startMs: rangeStart, endMs: rangeEnd }) =>
        rangeStart !== null &&
        rangeEnd !== null &&
        nextStart < rangeEnd &&
        nextStart + durationMs > rangeStart
    );
    if (!range || range.endMs === null) break;
    nextStart = range.endMs + 2_000;
  }
  return clamp(nextStart, 0, Math.max(0, videoDurationMs - durationMs));
};

const chooseWindows = (
  videoDurationMs: number,
  rawSegments: AlignInput['skipSegments']
): AlignWindow[] => {
  const durationMs = Math.round(videoDurationMs);
  const windowMs = 60_000;
  if (durationMs <= windowMs) {
    return [{ startMs: 0, durationMs }];
  }

  const excluded = rawSegments
    .map(normalizeSegment)
    .filter(({ startMs, endMs }) => startMs !== null && endMs !== null && endMs > startMs);

  const introEnd = excluded
    .filter(({ type }) => type === 'intro' || type === 'recap')
    .filter(({ startMs }) => startMs !== null && startMs < 300_000)
    .reduce((max, segment) => Math.max(max, segment.endMs || 0), 0);

  // Lấy 2 windows liên tiếp (0-60s và 60-120s) để có đủ dialogue cho alignment
  // Phần lớn phim ít dialogue ở phút đầu, nhưng dialogue dày từ phút 1-2
  const firstStart = introEnd || 0;
  const windows: AlignWindow[] = [];

  const start1 = movePastExcludedRange(firstStart, windowMs, excluded, durationMs);
  windows.push({ startMs: start1, durationMs: windowMs });

  // Window thứ 2: ngay sau window 1
  const secondStart = start1 + windowMs;
  if (secondStart + windowMs <= durationMs) {
    const start2 = movePastExcludedRange(secondStart, windowMs, excluded, durationMs);
    windows.push({ startMs: start2, durationMs: windowMs });
  }

  return windows;
};

const parseProxyHeaders = (rawHeaders: string | null) => {
  if (!rawHeaders) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawHeaders);
  } catch {
    throw new Error('Invalid proxy headers');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid proxy headers');
  }

  return normalizeProxyHeaders(parsed as Record<string, string>);
};

const resolveAlignmentSource = async (input: AlignInput): Promise<ResolvedAlignmentSource> => {
  let parsed: URL;
  try {
    parsed = new URL(input.sourceUrl);
  } catch {
    throw new Error('Invalid media source URL');
  }

  const proxyKind = getProxyCapabilityKindForPath(parsed.pathname);
  const expectedProxyKind = input.sourceType === 'hls' ? 'm3u8' : 'media';
  const hasProxyCapability = parsed.searchParams.has('capability');

  if (!proxyKind || !hasProxyCapability) {
    return {
      url: await assertSafeUpstreamUrl(input.sourceUrl),
      headers: normalizeProxyHeaders(input.sourceHeaders),
    };
  }

  if (proxyKind !== expectedProxyKind) {
    throw new Error('Media source proxy type does not match sourceType');
  }

  const targetUrl = parsed.searchParams.get('url')?.trim() || '';
  const capability = parsed.searchParams.get('capability')?.trim() || '';
  if (!targetUrl || !capability) {
    throw new Error('Invalid media source proxy URL');
  }

  const safeTargetUrl = await assertSafeUpstreamUrl(targetUrl);
  const headers = parseProxyHeaders(parsed.searchParams.get('headers'));
  assertProxyCapability(capability, {
    kind: proxyKind,
    targetUrl: safeTargetUrl,
    headers,
  });

  return {
    url: safeTargetUrl,
    headers,
  };
};

const fetchAlignmentStream = async (
  sourceUrl: string,
  subtitleVtt: string,
  windows: AlignWindow[],
  onResult: (result: AlignResponse) => void
): Promise<ReadableStream> => {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ALIGN_SERVICE_TIMEOUT_MS);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (ALIGN_SERVICE_INTERNAL_TOKEN) {
    headers['x-internal-token'] = ALIGN_SERVICE_INTERNAL_TOKEN;
  }

  const response = await fetch(`${ALIGN_SERVICE_URL}/v1/transcribe-windows`, {
    method: 'POST',
    signal: controller.signal,
    headers,
    body: JSON.stringify({
      sourceUrl,
      subtitleVtt,
      windows,
    }),
  });

  if (!response.ok) {
    clearTimeout(timeout);
    const text = await response.text().catch(() => '');
    throw new Error(`Subtitle align service returned ${response.status}: ${text}`);
  }

  if (!response.body) {
    clearTimeout(timeout);
    throw new Error('No response body from subtitle align service');
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const reader = response.body.getReader();
  const encoder = new TextEncoder();
  let streamClosed = false;
  const heartbeat = setInterval(() => {
    if (!streamClosed) {
      void writer.write(encoder.encode(': keep-alive\n\n')).catch(() => null);
    }
  }, 15_000);

  (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              if (data.type === 'result' && data.data) {
                onResult(data.data as AlignResponse);
              }
            } catch {
              continue;
            }
          }
        }
        await writer.write(value);
      }
    } catch (error) {
      const message = timedOut
        ? `Subtitle alignment timed out after ${Math.ceil(ALIGN_SERVICE_TIMEOUT_MS / 1000)} seconds`
        : error instanceof Error
          ? error.message
          : 'Subtitle alignment stream failed';
      console.error('Error proxying alignment stream:', error);
      try {
        await writer.write(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`)
        );
      } catch {
        return;
      }
    } finally {
      streamClosed = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      await writer.close().catch(() => null);
    }
  })();

  return readable;
};

export default defineEventHandler(async event => {
  if (event.method !== 'POST') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method not allowed',
    });
  }

  const contentLength = Number(getRequestHeader(event, 'content-length') || 0);
  if (contentLength > ALIGN_MAX_BODY_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Subtitle alignment request is too large',
    });
  }

  let input: AlignInput;
  try {
    input = alignSchema.parse(await readBody(event));
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid subtitle alignment request',
    });
  }

  if (String(process.env.SUBTITLE_ALIGN_ENABLED).toLowerCase() === 'false') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Subtitle alignment is disabled',
    });
  }

  let resolvedSource: ResolvedAlignmentSource;
  try {
    resolvedSource = await resolveAlignmentSource(input);
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unsafe media source URL',
    });
  }

  const proxyPath = input.sourceType === 'hls' ? '/api/m3u8-proxy' : '/api/media-proxy';
  const proxyKind = input.sourceType === 'hls' ? 'm3u8' : 'media';
  const internalSourceUrl = buildProxyRequestUrl(
    ALIGN_BACKEND_INTERNAL_BASE_URL,
    proxyPath,
    proxyKind,
    resolvedSource.url,
    resolvedSource.headers,
    '',
    Math.ceil(ALIGN_SERVICE_TIMEOUT_MS / 1000) + 300
  );
  const windows = chooseWindows(input.videoDurationMs, input.skipSegments);

  setResponseHeader(event, 'content-type', 'text/event-stream');
  setResponseHeader(event, 'cache-control', 'no-cache, no-transform');
  setResponseHeader(event, 'x-accel-buffering', 'no');

  try {
    const stream = await fetchAlignmentStream(
      internalSourceUrl,
      input.subtitleVtt,
      windows,
      result => {
        const response: AlignResponse = {
          ...result,
          windows,
          model: result.model || ALIGN_MODEL,
          cached: false,
        };
      }
    );
    return sendStream(event, stream);
  } catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: error instanceof Error ? error.message : 'Subtitle align service unavailable',
    });
  }
});
