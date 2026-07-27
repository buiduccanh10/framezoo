import type { H3Event } from 'h3';
import { getRequestHeader } from 'h3';

export const isValidInternalApiRequest = (event: H3Event) => {
  const expected = process.env.INTERNAL_API_TOKEN?.trim();
  if (!expected) return false;

  const headerToken = getRequestHeader(event, 'x-internal-token')?.trim();
  return headerToken === expected;
};
