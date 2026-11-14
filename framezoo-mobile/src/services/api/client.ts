import { Platform } from 'react-native';

import { mobileStorage } from '@/services/storage/storage';
import { useAuthStore } from '@/state/auth/store';
import type { AccountWithToken } from '@/types';
import { version as APP_VERSION } from '../../../package.json';

const GUEST_ID_KEY = '@framezoo/mobile/guest_id';
const GUEST_TOKEN_KEY = '@framezoo/mobile/guest_token';
const GUEST_TOKEN_EXP_KEY = '@framezoo/mobile/guest_token_exp';

let inMemoryGuestId: string | null = null;
let inMemoryGuestToken: string | null = null;
let inMemoryGuestTokenExp = 0;
let pendingGuestTokenPromise: Promise<string | null> | null = null;

function buildNativeUserAgent(): string | null {
  if (Platform.OS === 'ios') {
    return `Framezoo-Mobile/${APP_VERSION} (iPhone; iOS)`;
  }
  if (Platform.OS === 'android') {
    return `Framezoo-Mobile/${APP_VERSION} (Android)`;
  }
  return null;
}

function isPublicGuestPath(path: string): boolean {
  const clean = path.split('?')[0] ?? '';
  const normalized = clean.startsWith('/') ? clean : `/${clean}`;
  return (
    normalized === '/api/tmdb' ||
    normalized.startsWith('/api/tmdb/') ||
    normalized === '/api/skip-segments' ||
    normalized === '/api/subtitle-align' ||
    normalized.startsWith('/addon/subtitles/')
  );
}

async function ensureMobileGuestToken(baseUrl: string): Promise<string | null> {
  const now = Date.now();
  if (inMemoryGuestToken && inMemoryGuestTokenExp - now > 30_000) {
    return inMemoryGuestToken;
  }

  try {
    const [storedToken, storedExpRaw, storedGuestId] = await Promise.all([
      mobileStorage.get(GUEST_TOKEN_KEY),
      mobileStorage.get(GUEST_TOKEN_EXP_KEY),
      inMemoryGuestId
        ? Promise.resolve(inMemoryGuestId)
        : mobileStorage.get(GUEST_ID_KEY),
    ]);
    if (storedGuestId) inMemoryGuestId = storedGuestId;
    const storedExp = Number(storedExpRaw || '0');
    if (storedToken && storedExp - now > 30_000) {
      inMemoryGuestToken = storedToken;
      inMemoryGuestTokenExp = storedExp;
      return storedToken;
    }
  } catch {
    // Ignore storage read errors and fall back to fresh token request.
  }

  if (pendingGuestTokenPromise) {
    return pendingGuestTokenPromise;
  }

  pendingGuestTokenPromise = (async () => {
    try {
      const guestHeaders = new Headers({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      });
      if (APP_VERSION) {
        guestHeaders.set('X-App-Version', APP_VERSION);
      }
      const userAgent = buildNativeUserAgent();
      if (userAgent) {
        guestHeaders.set('User-Agent', userAgent);
      }

      const response = await fetch(joinUrl(baseUrl, '/api/auth/guest'), {
        method: 'POST',
        headers: guestHeaders,
        body: JSON.stringify(
          inMemoryGuestId ? { guestId: inMemoryGuestId } : {},
        ),
      });
      if (!response.ok) return null;

      const data = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
        guest_id?: string;
        guestId?: string;
      };
      if (!data.access_token) return null;

      const token = data.access_token;
      const resolvedGuestId = data.guest_id || data.guestId || inMemoryGuestId;
      const expTimestamp = Date.now() + (data.expires_in ?? 1800) * 1000;

      inMemoryGuestToken = token;
      inMemoryGuestTokenExp = expTimestamp;
      if (resolvedGuestId) inMemoryGuestId = resolvedGuestId;

      await Promise.all([
        mobileStorage.set(GUEST_TOKEN_KEY, token),
        mobileStorage.set(GUEST_TOKEN_EXP_KEY, String(expTimestamp)),
        resolvedGuestId
          ? mobileStorage.set(GUEST_ID_KEY, resolvedGuestId)
          : Promise.resolve(),
      ]).catch(() => {});

      return token;
    } catch {
      return null;
    } finally {
      pendingGuestTokenPromise = null;
    }
  })();

  return pendingGuestTokenPromise;
}

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
  if (APP_VERSION && !headers.has('X-App-Version')) {
    headers.set('X-App-Version', APP_VERSION);
  }
  const nativeUserAgent = buildNativeUserAgent();
  if (nativeUserAgent && !headers.has('User-Agent')) {
    headers.set('User-Agent', nativeUserAgent);
  }
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const activeToken =
    options.account?.token ?? useAuthStore.getState().account?.token;
  if (activeToken) {
    headers.set('Authorization', `Bearer ${activeToken}`);
  } else if (!headers.has('Authorization') && isPublicGuestPath(path)) {
    const guestToken = await ensureMobileGuestToken(baseUrl);
    if (guestToken) {
      headers.set('Authorization', `Bearer ${guestToken}`);
    }
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
