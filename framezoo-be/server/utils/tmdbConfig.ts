export const TMDB_PRIMARY_BASE_URL = 'https://api.tmdb.org/3';
export const TMDB_FALLBACK_BASE_URL = 'https://api.themoviedb.org/3';

export const TMDB_TIMEOUT_MS = 15_000;
export const TMDB_RETRY_ATTEMPTS = 3;
export const TMDB_RETRY_DELAY_MS = 2_000;
export const TMDB_RETRY_STATUS_CODES = [408, 425, 429, 500, 502, 503, 504];

export function getTmdbErrorStatus(error: any): number | undefined {
  const status = error?.response?.status ?? error?.statusCode ?? error?.status;
  return typeof status === 'number' ? status : undefined;
}

export function isTmdbTimeoutError(error: any): boolean {
  const name = String(error?.name || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  return (
    name === 'aborterror' ||
    name === 'timeouterror' ||
    code === 'etimedout' ||
    code === 'abort_err' ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('aborted')
  );
}

export function isRetryableTmdbError(error: any): boolean {
  const status = getTmdbErrorStatus(error);

  if (isTmdbTimeoutError(error) || status === undefined) {
    return true;
  }

  return TMDB_RETRY_STATUS_CODES.includes(status);
}
