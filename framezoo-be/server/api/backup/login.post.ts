import { defineEventHandler, readBody, setCookie } from 'h3';
import jwt from 'jsonwebtoken';

export default defineEventHandler(async event => {
  const body = await readBody(event);
  const { username, password } = body || {};

  const envUser = process.env.ADMIN_USERNAME;
  const envPass = process.env.ADMIN_PASSWORD;

  if (!envUser || !envPass) {
    throw createError({
      statusCode: 500,
      message: 'Admin credentials are not configured on the server',
    });
  }

  if (username !== envUser || password !== envPass) {
    throw createError({
      statusCode: 401,
      message: 'Invalid credentials',
    });
  }

  const secret = process.env.CRYPTO_SECRET || 'fallback-secret';

  // Create token valid for 8 hours
  const token = jwt.sign({ username, role: 'env-admin' }, secret, { expiresIn: '8h' });

  // Set HTTP-only cookie
  setCookie(event, 'admin_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/backup',
    maxAge: 8 * 60 * 60,
  });

  return {
    success: true,
    token, // Return token for frontend to use in Authorization header if needed
  };
});
