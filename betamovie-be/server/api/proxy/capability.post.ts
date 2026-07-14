import { z } from 'zod';
import { applyCorsHeaders } from '~/utils/cors';
import {
  assertSafeUpstreamUrl,
  buildProxyRequestUrl,
  issueProxyCapability,
  normalizeProxyHeaders,
  type ProxyCapabilityKind,
} from '~/utils/proxySecurity';

const capabilitySchema = z.object({
  kind: z.enum([
    'm3u8',
    'media',
    'preview',
    'preview-auto',
    'preview-file',
    'embed',
    'vixsrc',
  ]),
  url: z.string().trim().max(8192).optional(),
  headers: z
    .record(z.string().max(128), z.string().max(2048))
    .refine(value => Object.keys(value).length <= 32, 'Too many headers')
    .optional(),
  resource: z.string().trim().max(2048).optional(),
});

export default defineEventHandler(async event => {
  if (event.method === 'OPTIONS') {
    applyCorsHeaders(event, 'POST, OPTIONS');
    setResponseStatus(event, 204);
    return null;
  }

  if (event.method !== 'POST') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method not allowed',
    });
  }

  const contentLength = Number(getRequestHeader(event, 'content-length') || 0);
  if (contentLength > 64 * 1024) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Capability request is too large',
    });
  }

  let input: z.infer<typeof capabilitySchema>;
  try {
    input = capabilitySchema.parse(await readBody(event));
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid capability request',
    });
  }
  const kind = input.kind as ProxyCapabilityKind;
  const headers = normalizeProxyHeaders(input.headers || {});
  const resource = input.resource || '';
  let targetUrl = '';

  if (input.url) {
    try {
      targetUrl = await assertSafeUpstreamUrl(input.url);
    } catch {
      throw createError({
        statusCode: 400,
        statusMessage: 'Unsafe upstream URL',
      });
    }
  }

  if (['m3u8', 'media', 'preview', 'embed', 'vixsrc'].includes(kind) && !targetUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'URL is required for this capability kind',
    });
  }

  if (['preview-auto', 'preview-file'].includes(kind) && !resource) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Resource is required for this capability kind',
    });
  }

  const origin = getRequestURL(event).origin;
  const path =
    kind === 'm3u8'
      ? '/api/m3u8-proxy'
      : kind === 'media'
        ? '/api/media-proxy'
        : kind === 'preview'
          ? '/api/preview-proxy'
          : kind === 'preview-auto'
          ? '/api/preview/auto'
            : kind === 'preview-file'
              ? '/api/preview/file'
              : kind === 'vixsrc'
                ? '/api/proxy/vixsrc'
                : '/api/embed/ts-proxy';
  const ttlSeconds = 15 * 60;
  const capability = issueProxyCapability(kind, targetUrl, headers, resource, ttlSeconds);

  setHeader(event, 'cache-control', 'no-store');
  applyCorsHeaders(event, 'POST, OPTIONS');
  return {
    capability,
    url: buildProxyRequestUrl(origin, path, kind, targetUrl, headers, resource, ttlSeconds),
  };
});
