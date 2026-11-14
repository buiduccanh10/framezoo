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
  const existingEmail = await findUserByEmail(email);
  if (existingEmail) {
    throw createError({
      statusCode: 409,
      message: 'Email is already registered',
    });
  }

  try {
    return await createOtpChallenge({
      purpose: 'registration',
      email,
      event,
      template: 'registration-otp',
    });
  } catch (error) {
    throwOtpHttpError(error, event);
  }
});
