import { useAuth } from '~/utils/auth';
import { isValidInternalApiRequest } from '~/utils/internalApi';

const isPublicApiRequest = (path: string, method: string) => {
  // Subtitle alignment uses only submitted audio/caption data; guest or user token required.
  if (method === 'POST' && path === '/api/subtitle-align') return true;
  if (method !== 'GET') return false;
  if (path === '/api/skip-segments') return true;
  if (path.startsWith('/addon/subtitles/')) return true;
  return path === '/api/tmdb' || path.startsWith('/api/tmdb/');
};

const isGuestAuthRequest = (path: string, method: string) => {
  return (
    method === 'POST' &&
    (path === '/api/auth/guest' ||
      path === '/api/auth/session/guest' ||
      path === '/auth/guest')
  );
};

export default defineEventHandler(async event => {
  const path = event.path.split('?')[0] || '';

  // Manifest is public
  if (path === '/addon/subtitles/manifest.json') {
    return;
  }

  if (!path.startsWith('/api/') && !path.startsWith('/addon/subtitles/')) {
    return;
  }

  // Keep CORS preflight open.
  if (event.method === 'OPTIONS') {
    return;
  }

  // Internal API token bypasses user/guest auth.
  if (isValidInternalApiRequest(event)) {
    return;
  }

  // Endpoint to obtain guest tokens does not require an existing token.
  if (isGuestAuthRequest(path, event.method)) {
    return;
  }

  const auth = useAuth();
  const authHeader = getRequestHeader(event, 'authorization');
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  // 1. Check if it's a valid guest token
  if (bearerToken) {
    const guestPayload = auth.verifyGuestToken(bearerToken);
    if (guestPayload) {
      event.context.isGuest = true;
      event.context.guestId = guestPayload.gid;

      // Guest tokens are permitted ONLY on public API endpoints
      if (isPublicApiRequest(path, event.method)) {
        return;
      }

      throw createError({
        statusCode: 403,
        message: 'Authentication required for this resource',
      });
    }
  }

  // 2. Validate authenticated user session (via Bearer token or Cookie)
  const session = await auth.getCurrentSessionForEvent(event);
  event.context.session = session;
  event.context.isGuest = false;
});

