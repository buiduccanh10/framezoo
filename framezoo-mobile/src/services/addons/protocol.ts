import type {
  AddonProtocolRequest,
  AddonProtocolResponse,
  AddonProtocolResource,
  StremioManifest,
} from '@/types';

const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

export class AddonProtocolError extends Error {
  readonly url: string;
  readonly status: number | null;

  constructor(message: string, url: string, status: number | null = null) {
    super(message);
    this.name = 'AddonProtocolError';
    this.url = url;
    this.status = status;
  }
}

export interface AddonRuntime {
  loadManifest(manifestUrl: string): Promise<StremioManifest>;
  request<T>(
    request: AddonProtocolRequest,
  ): Promise<AddonProtocolResponse<T>>;
}

export function normalizeAddonManifestUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AddonProtocolError('Addon manifest URL is invalid', input);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AddonProtocolError(
      'Addon manifest must use HTTP or HTTPS',
      input,
    );
  }
  return url.toString();
}

function segment(value: string | undefined, label: string) {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new AddonProtocolError(`Addon ${label} is required`, value ?? '');
  }
  return encodeURIComponent(normalized);
}

export function getAddonResourceUrl(request: AddonProtocolRequest) {
  const manifestUrl = normalizeAddonManifestUrl(request.manifestUrl);
  const baseUrl = new URL('.', manifestUrl);
  let path: string;
  switch (request.resource) {
    case 'catalog':
      path = `catalog/${segment(request.type, 'type')}/${segment(
        request.catalogId ?? request.id ?? 'top',
        'catalog id',
      )}.json`;
      break;
    case 'meta':
    case 'stream':
    case 'subtitles':
      path = `${request.resource}/${segment(request.type, 'type')}/${segment(
        request.id,
        'id',
      )}.json`;
      break;
    case 'addon_catalog':
      path = `addon_catalog/${segment(request.type, 'type')}/${segment(
        request.id ?? 'default',
        'id',
      )}.json`;
      break;
    default: {
      const exhaustive: never = request.resource;
      throw new AddonProtocolError(
        `Unsupported addon resource: ${String(exhaustive)}`,
        manifestUrl,
      );
    }
  }
  return new URL(path, baseUrl).toString();
}

async function requestJson<T>(url: string): Promise<AddonProtocolResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_RESPONSE_SIZE) {
      throw new AddonProtocolError(
        'Addon response exceeds the maximum allowed size',
        url,
        response.status,
      );
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_SIZE) {
      throw new AddonProtocolError(
        'Addon response exceeds the maximum allowed size',
        url,
        response.status,
      );
    }
    if (!response.ok) {
      throw new AddonProtocolError(
        `Request failed with HTTP ${response.status}`,
        url,
        response.status,
      );
    }
    let body: T;
    try {
      body = JSON.parse(text) as T;
    } catch {
      throw new AddonProtocolError('Addon returned invalid JSON', url, response.status);
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { statusCode: response.status, headers, finalUrl: response.url || url, body };
  } catch (error) {
    if (error instanceof AddonProtocolError) throw error;
    const message =
      controller.signal.aborted
        ? `Addon request timed out after ${TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : 'Addon request failed';
    throw new AddonProtocolError(message, url);
  } finally {
    clearTimeout(timer);
  }
}

export const addonRuntime = {
  async loadManifest(manifestUrl: string) {
    const url = normalizeAddonManifestUrl(manifestUrl);
    const manifest = (await requestJson<StremioManifest>(url)).body;
    if (
      !manifest ||
      typeof manifest.id !== 'string' ||
      typeof manifest.name !== 'string' ||
      typeof manifest.version !== 'string'
    ) {
      throw new AddonProtocolError(
        'Addon manifest is missing id, name or version',
        url,
      );
    }
    return manifest;
  },
  async request<T>(request: AddonProtocolRequest) {
    return requestJson<T>(getAddonResourceUrl(request));
  },
} satisfies AddonRuntime;

export function hasAddonResource(
  manifest: StremioManifest,
  resource: AddonProtocolResource,
) {
  return (manifest.resources ?? []).some((entry) =>
    typeof entry === 'string' ? entry === resource : entry.name === resource,
  );
}
