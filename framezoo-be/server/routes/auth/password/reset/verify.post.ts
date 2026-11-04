import { z } from 'zod';
import { verifyOtp } from '~/utils/emailOtp';
import { throwOtpHttpError } from '~/utils/otpHttp';

const schema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});

export default defineEventHandler(async event => {
  const result = schema.safeParse(await readBody(event));
  if (!result.success) {
    throw createError({ statusCode: 400, message: 'Invalid request body' });
  }

  try {
    const verified = await verifyOtp({
      challengeId: result.data.challengeId,
      code: result.data.code,
      purpose: 'password_reset',
    });

    return { actionToken: verified.actionToken };
  } catch (error) {
    throwOtpHttpError(error, event);
  }
});
