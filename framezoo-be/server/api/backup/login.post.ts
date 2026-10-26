import { createHash, timingSafeEqual } from 'node:crypto';
import { defineEventHandler, readBody, setCookie } from 'h3';
import { ADMIN_COOKIE, ADMIN_SESSION_TTL, createAdminSession } from '~/utils/admin';

const safeEqual = (candidate: string, expected: string) => {
  const candidateDigest = createHash('sha256').update(candidate).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
};

export default defineEventHandler(async event => {
  const body = await readBody(event);
  const username = typeof body?.username === 'string' ? body.username : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  const envUser = process.env.ADMIN_USERNAME;
  const envPass = process.env.ADMIN_PASSWORD;

  if (!envUser || !envPass) {
    throw createError({
      statusCode: 500,
      message: 'Admin credentials are not configured on the server',
    });
  }

  // Basic brute-force protection: constant delay of 1s
  await new Promise(resolve => setTimeout(resolve, 1000));

  if (
    username.length > 128 ||
    password.length > 256 ||
    !safeEqual(username, envUser) ||
    !safeEqual(password, envPass)
  ) {
    throw createError({
      statusCode: 401,
      message: 'Invalid credentials',
    });
  }

  const token = await createAdminSession(username);

  // Set HTTP-only cookie
  setCookie(event, ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api',
    maxAge: ADMIN_SESSION_TTL,
  });

  return { success: true };
});
