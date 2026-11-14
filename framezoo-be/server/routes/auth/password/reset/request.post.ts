import { z } from 'zod';
import { findUserByEmail, normalizeEmail } from '~/utils/accountIdentifier';
import { createOtpChallenge } from '~/utils/emailOtp';
import { throwOtpHttpError } from '~/utils/otpHttp';

const schema = z.object({
  email: z.string().trim().email().max(255),
});

export default defineEventHandler(async event => {
  const result = schema.safeParse(await readBody(event));
  if (!result.success) {
    throw createError({ statusCode: 400, message: 'Invalid request body' });
  }

  const email = normalizeEmail(result.data.email);
  const user = await findUserByEmail(email);

  // Keep the response generic so the endpoint does not enumerate accounts.
  if (!user) {
    return {
      message: 'If the email exists, a verification code has been sent.',
    };
  }

  try {
    const challenge = await createOtpChallenge({
      purpose: 'password_reset',
      email,
      userId: user.id,
      event,
      template: 'password-reset-otp',
    });

    return {
      message: 'If the email exists, a verification code has been sent.',
      ...challenge,
    };
  } catch (error) {
    throwOtpHttpError(error, event);
  }
});
