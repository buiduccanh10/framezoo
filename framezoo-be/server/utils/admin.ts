import { createHash, randomBytes } from 'node:crypto';
import { H3Event, createError, getCookie, getHeader } from 'h3';

const ADMIN_COOKIE = 'admin_session';
const ADMIN_SESSION_TTL = 8 * 60 * 60;
const ADMIN_SESSION_PREFIX = 'admin-session:';

type AdminSession = { username: string };

const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

const sessionKey = (token: string) => `${ADMIN_SESSION_PREFIX}${hashToken(token)}`;

const adminStorage = () => useStorage('cache');

export const createAdminSession = async (username: string) => {
  const token = randomBytes(32).toString('base64url');

  try {
    await adminStorage().setItem<AdminSession>(
      sessionKey(token),
      { username },
      {
        ttl: ADMIN_SESSION_TTL,
      }
    );
  } catch {
    throw createError({
      statusCode: 503,
      message: 'Admin session storage is unavailable',
    });
  }

  return token;
};

export const revokeAdminSession = async (event: H3Event) => {
  const token = getCookie(event, ADMIN_COOKIE);
  if (!token) return;

  try {
    await adminStorage().removeItem(sessionKey(token));
  } catch {
    throw createError({
      statusCode: 503,
      message: 'Admin session storage is unavailable',
    });
  }
};

export const requireAdmin = async (event: H3Event) => {
  const token = getCookie(event, ADMIN_COOKIE);
  if (!token) {
    throw createError({
      statusCode: 401,
      message: 'Unauthorized: Missing admin session',
    });
  }

  // SameSite cookies stop cross-site requests. This non-simple header closes
  // the remaining CSRF path for same-site or misconfigured deployments.
  if (event.method !== 'GET' && getHeader(event, 'x-admin-request') !== '1') {
    throw createError({
      statusCode: 403,
      message: 'Forbidden: Admin request header is required',
    });
  }

  try {
    const session = await adminStorage().getItem<AdminSession>(sessionKey(token));
    if (!session?.username) throw new Error('Unknown admin session');
    return session;
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error;
    throw createError({
      statusCode: 403,
      message: 'Forbidden: Invalid or expired admin session',
    });
  }
};

export { ADMIN_COOKIE, ADMIN_SESSION_TTL };
