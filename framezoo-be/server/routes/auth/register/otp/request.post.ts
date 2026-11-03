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
  const existingEmail = await prisma.users.findUnique({
    where: { email },
    select: { id: true },
  });
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
      send: code => sendEmail({ to: email, template: 'registration-otp', code }),
    });
  } catch (error) {
    throwOtpHttpError(error);
  }
});
