import { H3Event, createError, getCookie, getHeader } from 'h3';
import jwt from 'jsonwebtoken';

export const requireAdmin = async (event: H3Event) => {
  const token =
    getCookie(event, 'admin_session') || getHeader(event, 'Authorization')?.replace('Bearer ', '');

  if (!token) {
    throw createError({
      statusCode: 401,
      message: 'Unauthorized: Missing token',
    });
  }

  try {
    const secret = process.env.CRYPTO_SECRET || 'fallback-secret';
    const decoded = jwt.verify(token, secret) as any;

    if (decoded.role !== 'env-admin') {
      throw new Error('Invalid role');
    }

    return decoded;
  } catch (error) {
    throw createError({
      statusCode: 403,
      message: 'Forbidden: Invalid or expired admin token',
    });
  }
};
