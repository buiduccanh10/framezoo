import { buildProxyRequestUrl } from '~/utils/proxySecurity';

type PreviewHeaders = Record<string, string>;

export interface StreamPreview {
  kind: 'vtt';
  vtt: string;
  sprite?: string;
}

interface BuildStreamPreviewOptions {
  origin: string;
  provider: string;
  mediaType: 'movie' | 'tv';
  tmdbId: string;
  season?: number | null;
  episode?: number | null;
  headers?: PreviewHeaders;
}

const TEMPLATE_TOKEN_RE = /\{([a-zA-Z0-9_]+)\}/g;
const PREVIEW_IMAGE_EXT_RE = /\.(?:avif|webp|png|jpe?g)(?:[?#].*)?$/i;
const PREVIEW_ASSET_FILE_RE = /^[a-zA-Z0-9._-]{1,160}\.(?:avif|webp|png|jpe?g)$/i;
const PREVIEW_ASSET_KEY_RE = /^[a-zA-Z0-9._:-]{1,200}$/;

const upperProvider = (provider: string) => provider.replace(/[^a-z0-9]+/gi, '_').toUpperCase();

const getTemplate = (baseName: string, provider: string) => {
  const suffix = upperProvider(provider);
  return process.env[`${baseName}_${suffix}`] || process.env[baseName] || '';
};

const toPadded = (value?: number | null) =>
  typeof value === 'number' && Number.isFinite(value) ? String(value).padStart(2, '0') : '';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const resolveTemplateUrl = (
  template: string,
  baseUrl: string | null,
  tokens: Record<string, string>
) => {
  const interpolated = template.replace(TEMPLATE_TOKEN_RE, (_match, token) => tokens[token] || '');
  if (!interpolated) {
    return '';
  }

  try {
    if (/^https?:\/\//i.test(interpolated)) {
      return new URL(interpolated).toString();
    }

    if (baseUrl) {
      return new URL(interpolated, baseUrl).toString();
    }
  } catch {
    return '';
  }

  return '';
};

const buildProxyUrl = (origin: string, targetUrl: string, headers: PreviewHeaders) => {
  return buildProxyRequestUrl(origin, '/api/preview-proxy', 'preview', targetUrl, headers);
};

export const buildPreviewAssetKey = ({
  mediaType,
  tmdbId,
  season,
  episode,
}: Omit<BuildStreamPreviewOptions, 'origin' | 'headers'>) => {
  const parts = [mediaType, tmdbId];
  if (typeof season === 'number') parts.push(`s${season}`);
  if (typeof episode === 'number') parts.push(`e${episode}`);
  return parts.join(':');
};

export const buildPreviewAutoResource = (
  params: Pick<
    BuildStreamPreviewOptions,
    'provider' | 'mediaType' | 'tmdbId' | 'season' | 'episode'
  >
) => {
  const query = new URLSearchParams({
    provider: params.provider,
    type: params.mediaType,
    tmdbId: params.tmdbId,
  });

  if (typeof params.season === 'number') {
    query.set('season', String(params.season));
  }

  if (typeof params.episode === 'number') {
    query.set('episode', String(params.episode));
  }

  return query.toString();
};

export const buildPreviewFileResource = (key: string, file: string) => `${key}|${file}`;

export const isValidPreviewAssetKey = (key: string) => PREVIEW_ASSET_KEY_RE.test(key);

export const isValidPreviewAssetFile = (file: string) => PREVIEW_ASSET_FILE_RE.test(file);

export const parsePreviewFileResource = (resource: string) => {
  const separator = resource.indexOf('|');
  if (separator <= 0 || separator === resource.length - 1) {
    return null;
  }

  const key = resource.slice(0, separator);
  const file = resource.slice(separator + 1);
  if (!isValidPreviewAssetKey(key) || !isValidPreviewAssetFile(file)) {
    return null;
  }

  return { key, file };
};

export const parsePreviewAutoResource = (resource: string) => {
  const params = new URLSearchParams(resource);
  const provider = params.get('provider') || '';
  const mediaType =
    params.get('type') === 'tv' ? 'tv' : params.get('type') === 'movie' ? 'movie' : '';
  const tmdbId = params.get('tmdbId') || '';
  const seasonValue = params.get('season');
  const episodeValue = params.get('episode');
  const season = seasonValue === null ? null : Number.parseInt(seasonValue, 10);
  const episode = episodeValue === null ? null : Number.parseInt(episodeValue, 10);

  if (
    !provider ||
    !mediaType ||
    !tmdbId ||
    (seasonValue !== null && !Number.isInteger(season)) ||
    (episodeValue !== null && !Number.isInteger(episode))
  ) {
    return null;
  }

  return {
    provider,
    mediaType,
    tmdbId,
    season,
    episode,
  } as const;
};

const buildGeneratedPreviewUrl = (
  origin: string,
  params: Pick<
    BuildStreamPreviewOptions,
    'provider' | 'mediaType' | 'tmdbId' | 'season' | 'episode'
  >
) => {
  return buildProxyRequestUrl(
    origin,
    '/api/preview/auto',
    'preview-auto',
    '',
    {},
    buildPreviewAutoResource(params)
  );
};

export const buildStreamPreview = ({
  origin,
  provider,
  mediaType,
  tmdbId,
  season,
  episode,
  headers = {},
}: BuildStreamPreviewOptions): StreamPreview | undefined => {
  const vttTemplate = getTemplate('PREVIEW_VTT_TEMPLATE', provider);
  if (!vttTemplate) {
    return {
      kind: 'vtt',
      vtt: buildGeneratedPreviewUrl(origin, { provider, mediaType, tmdbId, season, episode }),
    };
  }

  const baseUrl =
    process.env[`PREVIEW_BASE_URL_${upperProvider(provider)}`] ||
    process.env.PREVIEW_BASE_URL ||
    headers.Referer ||
    headers.referer ||
    headers.Origin ||
    headers.origin ||
    null;

  const seasonValue = typeof season === 'number' ? String(season) : '';
  const episodeValue = typeof episode === 'number' ? String(episode) : '';
  const mediaPath =
    mediaType === 'movie'
      ? `${mediaType}/${tmdbId}`
      : `${mediaType}/${tmdbId}/${seasonValue}/${episodeValue}`;

  const tokens = {
    provider,
    type: mediaType,
    tmdbId,
    season: seasonValue,
    episode: episodeValue,
    seasonPadded: toPadded(season),
    episodePadded: toPadded(episode),
    seasonSegment: seasonValue ? `/${seasonValue}` : '',
    episodeSegment: episodeValue ? `/${episodeValue}` : '',
    mediaPath,
  };

  const upstreamVttUrl = resolveTemplateUrl(vttTemplate, baseUrl, tokens);
  if (!upstreamVttUrl) {
    return undefined;
  }

  const spriteTemplate = getTemplate('PREVIEW_SPRITE_TEMPLATE', provider);
  const upstreamSpriteUrl = spriteTemplate
    ? resolveTemplateUrl(spriteTemplate, baseUrl, tokens)
    : '';

  return {
    kind: 'vtt',
    vtt: buildProxyUrl(origin, upstreamVttUrl, headers),
    sprite: upstreamSpriteUrl ? buildProxyUrl(origin, upstreamSpriteUrl, headers) : undefined,
  };
};

const isLikelyPreviewAssetLine = (line: string) => {
  if (!PREVIEW_IMAGE_EXT_RE.test(line)) {
    return false;
  }

  return (
    /^https?:\/\//i.test(line) ||
    line.startsWith('/') ||
    line.startsWith('./') ||
    line.startsWith('../') ||
    !line.includes(' ')
  );
};

export const rewriteVttPayload = (
  payload: string,
  vttUrl: string,
  origin: string,
  headers: PreviewHeaders
) => {
  const lines = payload.split(/\r?\n/);

  return lines
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed === 'WEBVTT') return line;
      if (trimmed.startsWith('NOTE')) return line;
      if (trimmed.includes('-->')) return line;
      if (/^\d+$/.test(trimmed)) return line;
      if (!isLikelyPreviewAssetLine(trimmed)) return line;

      try {
        const absolute = new URL(trimmed, vttUrl);
        const fragment = absolute.hash;
        absolute.hash = '';

        const proxied = buildProxyUrl(origin, absolute.toString(), headers);
        return line.replace(trimmed, `${proxied}${fragment}`);
      } catch {
        return line;
      }
    })
    .join('\n');
};

export const buildPreviewCacheKey = (targetUrl: string, headers: PreviewHeaders) => {
  const referer = headers.Referer || headers.referer || '';
  const origin = headers.Origin || headers.origin || '';
  return trimTrailingSlash(
    `${targetUrl}|referer=${referer}|origin=${origin}|ua=${headers['User-Agent'] || headers['user-agent'] || ''}`
  );
};
