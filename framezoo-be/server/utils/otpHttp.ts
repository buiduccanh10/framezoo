import { OtpError } from './emailOtp';
import type { H3Event } from 'h3';

export function throwOtpHttpError(error: unknown, event?: H3Event): never {
  if (!(error instanceof OtpError)) throw error;

  if (event && error.retryAfterSeconds) {
    setHeader(event, 'Retry-After', error.retryAfterSeconds);
  }

  const statusCode =
    error.code === 'cooldown' || error.code === 'locked'
      ? 429
      : error.code === 'idempotency_invalid'
        ? 400
        : error.code === 'idempotency_conflict' || error.code === 'idempotency_in_progress'
          ? 409
          : error.code === 'rate_limit_unavailable'
            ? 503
            : error.code === 'smtp'
              ? 503
              : error.code === 'not_found' || error.code === 'invalid'
                ? 400
                : 410;

  throw createError({
    statusCode,
    message: error.message,
  });
}
