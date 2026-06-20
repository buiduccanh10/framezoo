import type { H3Event } from 'h3';
import { useAuth } from '~/utils/auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type H3EventCompat = any;

const parseTokenRequest = async (event: H3EventCompat) => {
  const contentType = (getRequestHeader(event, 'content-type') || '').toLowerCase();

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const rawBody = (await readRawBody(event, 'utf8').catch(() => '')) || '';
    const params = new URLSearchParams(rawBody);

    return {
      grantType: params.get('grant_type') || '',
      refreshToken: params.get('refresh_token') || undefined,
    };
  }

  const body = (await readBody(event).catch(() => ({}))) as Record<string, unknown>;

  return {
    grantType: typeof body.grant_type === 'string' ? body.grant_type : '',
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
  };
};

export default defineEventHandler(async event => {
  const auth = useAuth();
  const { grantType, refreshToken } = await parseTokenRequest(event);

  if (grantType !== 'refresh_token') {
    throw createError({
      statusCode: 400,
      statusMessage: 'unsupported_grant_type',
      message: 'Only refresh_token grant type is supported',
    });
  }

  const token = refreshToken || auth.getRefreshTokenForEvent(event);
  if (!token) {
    throw createError({
      statusCode: 400,
      statusMessage: 'invalid_request',
      message: 'Missing refresh token',
    });
  }

  const rotated = await auth.rotateRefreshToken(token, { rotate: true });
  if (!rotated.success) {
    throw createError({
      statusCode: 401,
      statusMessage: 'invalid_grant',
      message: `Invalid or expired refresh token: ${rotated.reason}`,
    });
  }

  auth.setAuthCookies(event, rotated.tokens);
  return auth.toOAuthTokenResponse(rotated.tokens);
});
