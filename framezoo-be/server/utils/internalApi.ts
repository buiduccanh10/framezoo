import { createHash, timingSafeEqual } from 'node:crypto';
import { getRequestHeader, type H3Event } from 'h3';

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

export const isValidInternalApiRequest = (event: H3Event): boolean => {
  const expected = process.env.INTERNAL_API_TOKEN?.trim();
  if (!expected) return false;

  const headerToken = getRequestHeader(event, 'x-internal-token')?.trim();
  if (!headerToken) return false;

  return timingSafeEqual(sha256(headerToken), sha256(expected));
};
