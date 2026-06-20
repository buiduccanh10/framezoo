import { prisma } from './prisma';
import jwt from 'jsonwebtoken';
const { sign, verify } = jwt;
import { randomUUID } from 'crypto';
import type { H3Event } from 'h3';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type H3EventCompat = any;
import type { JwtPayload } from 'jsonwebtoken';
import type { CookieSerializeOptions } from 'cookie-es';

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'bm_session';
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || 'bm_refresh';

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const ACCESS_TOKEN_EXPIRY_SECONDS = parsePositiveInt(
  process.env.ACCESS_TOKEN_EXPIRY_SECONDS,
  5 * 60
);
const REFRESH_TOKEN_EXPIRY_SECONDS = parsePositiveInt(
  process.env.REFRESH_TOKEN_EXPIRY_SECONDS,
  30 * 24 * 60 * 60
);
const SESSION_EXPIRY_MS = REFRESH_TOKEN_EXPIRY_SECONDS * 1000;
const SESSION_EXPIRY_SECONDS = REFRESH_TOKEN_EXPIRY_SECONDS;

type AccessTokenPayload = {
  sid: string;
  typ?: 'access';
};

type RefreshTokenPayload = {
  sid: string;
  typ: 'refresh';
  jti: string;
};

export type SessionTokenBundle = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshTokenExpiresIn: number;
};

const buildOAuthTokenResponse = (tokens: SessionTokenBundle) => ({
  access_token: tokens.accessToken,
  token_type: tokens.tokenType,
  expires_in: tokens.expiresIn,
  refresh_token: tokens.refreshToken,
  refresh_token_expires_in: tokens.refreshTokenExpiresIn,
  accessToken: tokens.accessToken,
  tokenType: tokens.tokenType,
  expiresIn: tokens.expiresIn,
  refreshToken: tokens.refreshToken,
  refreshTokenExpiresIn: tokens.refreshTokenExpiresIn,
});

export function useAuth() {
  const getCryptoSecret = () => {
    const runtimeConfig = useRuntimeConfig();
    const cryptoSecret = runtimeConfig.cryptoSecret || process.env.CRYPTO_SECRET;

    if (!cryptoSecret) {
      throw new Error('CRYPTO_SECRET environment variable is not set');
    }

    return cryptoSecret;
  };

  const isSecureCookieRequest = (event: H3EventCompat) => {
    const isHttps = getRequestProtocol(event, { xForwardedProto: true }) === 'https';
    const host = getRequestHost(event, { xForwardedHost: true }).split(':')[0];
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return isHttps || (process.env.NODE_ENV === 'production' && !isLocalhost);
  };

  const getCookieSameSite = (event: H3EventCompat): CookieSerializeOptions['sameSite'] => {
    const requestOrigin = getRequestHeader(event, 'origin');
    if (!requestOrigin) {
      return 'lax';
    }

    try {
      const requestOriginHost = new URL(requestOrigin).origin;
      const serverOrigin = getRequestURL(event).origin;

      if (requestOriginHost !== serverOrigin && isSecureCookieRequest(event)) {
        return 'none';
      }
    } catch {
      // Fall through to the default policy when origin parsing fails.
    }

    return 'lax';
  };

  const getCookieOptions = (
    event: H3EventCompat,
    maxAge: number
  ): Pick<CookieSerializeOptions, 'httpOnly' | 'sameSite' | 'secure' | 'path' | 'maxAge'> => ({
    httpOnly: true,
    sameSite: getCookieSameSite(event),
    secure: isSecureCookieRequest(event),
    path: '/',
    maxAge,
  });

  const getAccessToken = (event: H3EventCompat) => {
    // Prefer cookie first so stale Authorization headers from FE don't break auth.
    const cookieToken = getCookie(event, SESSION_COOKIE_NAME);
    if (cookieToken) {
      return cookieToken;
    }

    const authHeader = getRequestHeader(event, 'authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.split(' ')[1];
    }

    return null;
  };

  const getRefreshTokenForEvent = (event: H3EventCompat) =>
    getCookie(event, REFRESH_COOKIE_NAME) || null;

  const getSession = async (id: string) => {
    const session = await prisma.sessions.findUnique({
      where: { id },
    });

    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) return null;

    return session;
  };

  const ensureRefreshState = async (session: Awaited<ReturnType<typeof getSession>>) => {
    if (!session) return null;
    if (session.refresh_jti && session.refresh_expires_at) {
      return session;
    }

    return await prisma.sessions.update({
      where: { id: session.id },
      data: {
        refresh_jti: randomUUID(),
        refresh_expires_at: new Date(session.expires_at),
      },
    });
  };

  const getSessionAndBump = async (id: string) => {
    const session = await getSession(id);
    if (!session) return null;

    const now = new Date();
    const expiryDate = new Date(now.getTime() + SESSION_EXPIRY_MS);

    return await prisma.sessions.update({
      where: { id },
      data: {
        accessed_at: now,
        expires_at: expiryDate,
        refresh_jti: session.refresh_jti || randomUUID(),
        refresh_expires_at: expiryDate,
      },
    });
  };

  const makeSession = async (user: string, device: string, userAgent?: string) => {
    if (!userAgent) throw new Error('No useragent provided');

    const now = new Date();
    const expiryDate = new Date(now.getTime() + SESSION_EXPIRY_MS);

    return await prisma.sessions.create({
      data: {
        id: randomUUID(),
        user,
        device,
        user_agent: userAgent,
        created_at: now,
        accessed_at: now,
        expires_at: expiryDate,
        refresh_jti: randomUUID(),
        refresh_expires_at: expiryDate,
      },
    });
  };

  const makeAccessToken = (session: { id: string }) => {
    const cryptoSecret = getCryptoSecret();

    return sign({ sid: session.id, typ: 'access' }, cryptoSecret, {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
    });
  };

  const makeRefreshToken = (session: { id: string }, jti: string) => {
    const cryptoSecret = getCryptoSecret();

    return sign({ sid: session.id, typ: 'refresh' }, cryptoSecret, {
      algorithm: 'HS256',
      jwtid: jti,
      expiresIn: SESSION_EXPIRY_SECONDS,
    });
  };

  // Backward-compatible alias (historically this was the only token).
  const makeSessionToken = (session: { id: string }) => makeAccessToken(session);

  const verifyJwtPayload = (token: string): JwtPayload | null => {
    try {
      const cryptoSecret = getCryptoSecret();
      const payload = verify(token, cryptoSecret, {
        algorithms: ['HS256'],
      });

      if (typeof payload === 'string') return null;
      return payload as JwtPayload;
    } catch {
      return null;
    }
  };

  const verifyAccessToken = (token: string): AccessTokenPayload | null => {
    const payload = verifyJwtPayload(token);
    if (!payload) return null;

    if (payload.typ && payload.typ !== 'access') {
      return null;
    }

    if (typeof payload.sid !== 'string' || payload.sid.length === 0) {
      return null;
    }

    return { sid: payload.sid, typ: payload.typ as 'access' | undefined };
  };

  const verifyJwtPayloadWithReason = (
    token: string
  ): { payload: JwtPayload | null; error?: string } => {
    try {
      const cryptoSecret = getCryptoSecret();
      const payload = verify(token, cryptoSecret, {
        algorithms: ['HS256'],
      });

      if (typeof payload === 'string') {
        return { payload: null, error: 'payload_is_string' };
      }
      return { payload: payload as JwtPayload };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { payload: null, error: errMsg };
    }
  };

  const verifyRefreshTokenWithReason = (
    token: string
  ): { payload: RefreshTokenPayload | null; error?: string } => {
    const { payload, error } = verifyJwtPayloadWithReason(token);
    if (!payload) {
      return { payload: null, error };
    }

    if (payload.typ !== 'refresh') {
      return { payload: null, error: `invalid_token_type: ${payload.typ}` };
    }

    const sid = typeof payload.sid === 'string' ? payload.sid : '';
    const jti = typeof payload.jti === 'string' ? payload.jti : '';

    if (!sid || !jti) {
      return { payload: null, error: 'missing_sid_or_jti_in_payload' };
    }

    return {
      payload: {
        sid,
        typ: 'refresh',
        jti,
      },
    };
  };

  const verifyRefreshToken = (token: string): RefreshTokenPayload | null => {
    return verifyRefreshTokenWithReason(token).payload;
  };

  // Backward-compatible alias.
  const verifySessionToken = (token: string) => verifyAccessToken(token);

  const issueTokensForSession = async (
    session: Awaited<ReturnType<typeof getSessionAndBump>> | Awaited<ReturnType<typeof makeSession>>
  ) => {
    const hydrated = await ensureRefreshState(session);
    if (!hydrated?.refresh_jti) {
      throw new Error('Unable to issue refresh token for session');
    }

    const tokens: SessionTokenBundle = {
      accessToken: makeAccessToken(hydrated),
      refreshToken: makeRefreshToken(hydrated, hydrated.refresh_jti),
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
      refreshTokenExpiresIn: SESSION_EXPIRY_SECONDS,
    };

    return {
      session: hydrated,
      tokens,
    };
  };

  const rotateRefreshToken = async (
    refreshToken: string,
    options?: { rotate?: boolean }
  ): Promise<{
    success: boolean;
    reason?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session?: any;
    tokens?: SessionTokenBundle;
  }> => {
    const shouldRotate = options?.rotate ?? true;

    const { payload, error } = verifyRefreshTokenWithReason(refreshToken);
    if (!payload) {
      return { success: false, reason: error ?? 'invalid_token_payload' };
    }

    const session = await getSession(payload.sid);
    if (!session) {
      return { success: false, reason: 'session_not_found_or_expired' };
    }

    if (!session.refresh_jti || session.refresh_jti !== payload.jti) {
      return {
        success: false,
        reason: `jti_mismatch: expected ${session.refresh_jti || 'null'}, got ${payload.jti}`,
      };
    }

    if (!session.refresh_expires_at || new Date(session.refresh_expires_at) < new Date()) {
      return { success: false, reason: 'refresh_token_expired' };
    }

    const now = new Date();
    const expiryDate = new Date(now.getTime() + SESSION_EXPIRY_MS);
    const newRefreshJti = shouldRotate ? randomUUID() : session.refresh_jti;

    const updatedSession = await prisma.sessions.update({
      where: { id: session.id },
      data: {
        accessed_at: now,
        expires_at: expiryDate,
        refresh_jti: newRefreshJti,
        refresh_expires_at: expiryDate,
      },
    });

    const tokens: SessionTokenBundle = {
      accessToken: makeAccessToken(updatedSession),
      refreshToken: makeRefreshToken(updatedSession, newRefreshJti),
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
      refreshTokenExpiresIn: SESSION_EXPIRY_SECONDS,
    };

    return {
      success: true,
      session: updatedSession,
      tokens,
    };
  };

  const setSessionCookie = (event: H3EventCompat, token: string) => {
    setCookie(
      event,
      SESSION_COOKIE_NAME,
      token,
      getCookieOptions(event, ACCESS_TOKEN_EXPIRY_SECONDS)
    );
  };

  const setRefreshCookie = (event: H3EventCompat, token: string) => {
    setCookie(event, REFRESH_COOKIE_NAME, token, getCookieOptions(event, SESSION_EXPIRY_SECONDS));
  };

  const setAuthCookies = (event: H3EventCompat, tokens: SessionTokenBundle) => {
    setSessionCookie(event, tokens.accessToken);
    setRefreshCookie(event, tokens.refreshToken);
  };

  const clearSessionCookie = (event: H3EventCompat) => {
    deleteCookie(event, SESSION_COOKIE_NAME, {
      path: '/',
    });

    deleteCookie(event, REFRESH_COOKIE_NAME, {
      path: '/',
    });
  };

  const tryRefreshSessionFromEvent = async (event: H3EventCompat) => {
    const refreshToken = getRefreshTokenForEvent(event);
    if (!refreshToken) return null;

    const rotated = await rotateRefreshToken(refreshToken, { rotate: false });
    if (!rotated.success) {
      console.warn(`[auth] tryRefreshSessionFromEvent failed: ${rotated.reason}`);
      return null;
    }

    setAuthCookies(event, rotated.tokens);
    return rotated.session;
  };

  const resolveCurrentSessionFromEvent = async (event: H3EventCompat) => {
    const accessToken = getAccessToken(event);
    let tokenState: 'missing' | 'invalid' | 'expired_or_missing_session' = 'missing';

    if (accessToken) {
      const payload = verifyAccessToken(accessToken);
      if (!payload) {
        tokenState = 'invalid';
      } else {
        const session = await getSessionAndBump(payload.sid);
        if (session) {
          return session;
        }
        tokenState = 'expired_or_missing_session';
      }
    }

    const refreshedSession = await tryRefreshSessionFromEvent(event);
    if (refreshedSession) {
      return refreshedSession;
    }

    if (tokenState === 'missing') {
      throw createError({
        statusCode: 401,
        message: 'Unauthorized',
      });
    }

    if (tokenState === 'invalid') {
      throw createError({
        statusCode: 401,
        message: 'Invalid token',
      });
    }

    throw createError({
      statusCode: 401,
      message: 'Session not found or expired',
    });
  };

  const getCurrentSession = async () => {
    const event = useEvent();
    return resolveCurrentSessionFromEvent(event);
  };

  const getCurrentSessionForEvent = async (event: H3EventCompat) => {
    return resolveCurrentSessionFromEvent(event);
  };

  return {
    getSession,
    getSessionAndBump,
    makeSession,
    makeAccessToken,
    makeRefreshToken,
    makeSessionToken,
    verifyAccessToken,
    verifyRefreshToken,
    verifySessionToken,
    issueTokensForSession,
    rotateRefreshToken,
    getCurrentSession,
    getCurrentSessionForEvent,
    getRefreshTokenForEvent,
    setSessionCookie,
    setRefreshCookie,
    setAuthCookies,
    clearSessionCookie,
    toOAuthTokenResponse: buildOAuthTokenResponse,
    sessionCookieName: SESSION_COOKIE_NAME,
    refreshCookieName: REFRESH_COOKIE_NAME,
    accessTokenExpirySeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
    refreshTokenExpirySeconds: SESSION_EXPIRY_SECONDS,
  };
}
