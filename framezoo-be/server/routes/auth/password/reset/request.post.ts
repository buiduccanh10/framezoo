import { z } from 'zod';
import { normalizeEmail } from '~/utils/accountIdentifier';
import { prisma } from '~/utils/prisma';
import { createOtpChallenge } from '~/utils/emailOtp';
import { sendEmail } from '~/utils/email';
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
  const user = await prisma.users.findUnique({ where: { email } });

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
      send: code => sendEmail({ to: email, template: 'password-reset-otp', code }),
    });

    return {
      message: 'If the email exists, a verification code has been sent.',
      ...challenge,
    };
  } catch (error) {
    throwOtpHttpError(error);
  }
});
