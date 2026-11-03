import { z } from 'zod';
import { prisma } from '~/utils/prisma';
import { useAuth } from '~/utils/auth';
import { verifyOtp, createOtpChallenge } from '~/utils/emailOtp';
import { sendEmail } from '~/utils/email';
import { throwOtpHttpError } from '~/utils/otpHttp';

const schema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});

export default defineEventHandler(async event => {
  const auth = useAuth();
  const session = await auth.getCurrentSessionForEvent(event);
  if (!session) throw createError({ statusCode: 401, message: 'Unauthorized' });

  const result = schema.safeParse(await readBody(event));
  if (!result.success) {
    throw createError({ statusCode: 400, message: 'Invalid request body' });
  }

  let verified;
  try {
    verified = await verifyOtp({
      challengeId: result.data.challengeId,
      code: result.data.code,
      purpose: 'email_change_old',
      userId: session.user,
    });
  } catch (error) {
    throwOtpHttpError(error);
  }

  const oldPayload = verified.challenge.payload;
  const newEmail =
    oldPayload && typeof oldPayload === 'object' && !Array.isArray(oldPayload)
      ? (oldPayload as { newEmail?: unknown }).newEmail
      : null;
  if (typeof newEmail !== 'string') {
    throw createError({ statusCode: 400, message: 'Invalid email change flow' });
  }

  const existing = await prisma.users.findUnique({ where: { email: newEmail } });
  if (existing) throw createError({ statusCode: 409, message: 'Email is already registered' });

  try {
    const next = await createOtpChallenge({
      purpose: 'email_change_new',
      email: newEmail,
      userId: session.user,
      payload: { oldChallengeId: verified.challenge.id },
      event,
      send: code => sendEmail({ to: newEmail, template: 'email-change-new-otp', code }),
    });

    return {
      ...next,
    };
  } catch (error) {
    throwOtpHttpError(error);
  }
});
