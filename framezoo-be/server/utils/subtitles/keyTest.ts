export const SUBTITLE_KEY_PROVIDERS = ['wyzie', 'subsource', 'opensubtitles'] as const;

export type SubtitleKeyProvider = (typeof SUBTITLE_KEY_PROVIDERS)[number];

export type SubtitleKeyTestStatus =
  'empty' | 'valid' | 'invalid' | 'rate_limit' | 'error' | 'network_error';

export interface SubtitleKeyTestResult {
  valid: boolean;
  status: SubtitleKeyTestStatus;
  httpStatus?: number;
}

export function isSubtitleKeyProvider(value: unknown): value is SubtitleKeyProvider {
  return typeof value === 'string' && (SUBTITLE_KEY_PROVIDERS as readonly string[]).includes(value);
}

const PROVIDER_TEST_PROBES: Record<
  SubtitleKeyProvider,
  (apiKey: string) => { url: string; headers: Record<string, string> }
> = {
  wyzie: apiKey => ({
    url: `https://sub.wyzie.io/search?id=tt1877830&key=${encodeURIComponent(apiKey)}`,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; Framezoo/1.0)',
    },
  }),
  subsource: apiKey => ({
    url: 'https://api.subsource.net/api/v1/movies/search?searchType=imdb&imdb=tt1877830',
    headers: {
      Accept: 'application/json',
      'x-api-key': apiKey,
      'api-key': apiKey,
    },
  }),
  opensubtitles: apiKey => ({
    url: 'https://api.opensubtitles.com/api/v1/subtitles?imdb_id=1877830&type=movie',
    headers: {
      Accept: 'application/json',
      'Api-Key': apiKey,
      'User-Agent': 'Framezoo v1.0.0',
    },
  }),
};

export async function testSubtitleProviderKey(
  provider: SubtitleKeyProvider,
  rawApiKey: unknown,
  fetchFn: typeof fetch = fetch
): Promise<SubtitleKeyTestResult> {
  const apiKey =
    typeof rawApiKey === 'string'
      ? rawApiKey
          .trim()
          .replace(/[\r\n\t]/g, '')
          .slice(0, 256)
      : '';
  if (!apiKey) {
    return { valid: false, status: 'empty' };
  }

  const probe = PROVIDER_TEST_PROBES[provider](apiKey);
  try {
    const response = await fetchFn(probe.url, {
      signal: AbortSignal.timeout(8_000),
      headers: probe.headers,
    });

    if (response.ok) {
      return { valid: true, status: 'valid', httpStatus: response.status };
    }
    if (response.status === 401 || response.status === 403) {
      return { valid: false, status: 'invalid', httpStatus: response.status };
    }
    if (response.status === 429) {
      return { valid: false, status: 'rate_limit', httpStatus: 429 };
    }
    return { valid: false, status: 'error', httpStatus: response.status };
  } catch {
    return { valid: false, status: 'network_error' };
  }
}
