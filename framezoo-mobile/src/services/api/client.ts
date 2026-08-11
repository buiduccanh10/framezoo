import type { AccountWithToken } from '@/types';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface ApiRequestOptions extends RequestInit {
  account?: AccountWithToken | null;
}

export function joinUrl(baseUrl: string, path: string) {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  if (!baseUrl.trim()) {
    throw new ApiError('Backend URL is not configured', 0);
  }

  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.account?.token) {
    headers.set('Authorization', `Bearer ${options.account.token}`);
  }

  const response = await fetch(joinUrl(baseUrl, path), {
    ...options,
    headers,
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof body.message === 'string'
        ? body.message
        : `Request failed with HTTP ${response.status}`;
    throw new ApiError(message, response.status);
  }

  return body as T;
}
