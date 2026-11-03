import { OtpError } from './emailOtp';

export function throwOtpHttpError(error: unknown): never {
  if (!(error instanceof OtpError)) throw error;

  const statusCode =
    error.code === 'cooldown' || error.code === 'locked'
      ? 429
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
