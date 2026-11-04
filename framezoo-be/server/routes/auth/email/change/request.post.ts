import { z } from 'zod';
import { normalizeEmail } from '~/utils/accountIdentifier';
import { prisma } from '~/utils/prisma';
import { useAuth } from '~/utils/auth';
import { createOtpChallenge } from '~/utils/emailOtp';
import { throwOtpHttpError } from '~/utils/otpHttp';

const schema = z.object({
  newEmail: z.string().trim().email().max(255),
});

export default defineEventHandler(async event => {
  const auth = useAuth();
  const session = await auth.getCurrentSessionForEvent(event);
  if (!session) throw createError({ statusCode: 401, message: 'Unauthorized' });

  const result = schema.safeParse(await readBody(event));
  if (!result.success) {
    throw createError({ statusCode: 400, message: 'Invalid request body' });
  }

  const user = await prisma.users.findUnique({ where: { id: session.user } });
  if (!user?.email) throw createError({ statusCode: 400, message: 'Account has no email address' });
  const currentEmail = user.email;

  const newEmail = normalizeEmail(result.data.newEmail);
  if (newEmail === currentEmail) {
    throw createError({ statusCode: 400, message: 'New email must be different' });
  }

  const existing = await prisma.users.findUnique({ where: { email: newEmail } });
  if (existing) throw createError({ statusCode: 409, message: 'Email is already registered' });

  try {
    return await createOtpChallenge({
      purpose: 'email_change_old',
      email: currentEmail,
      userId: user.id,
      payload: { newEmail },
      event,
      template: 'email-change-old-otp',
    });
  } catch (error) {
    throwOtpHttpError(error, event);
  }
});
