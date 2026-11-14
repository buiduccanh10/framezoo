import { z } from 'zod';
import { findUserByEmail, normalizeEmail } from '~/utils/accountIdentifier';
import { useAuth } from '~/utils/auth';
import { verifyOtp, createOtpChallenge } from '~/utils/emailOtp';
import { throwOtpHttpError } from '~/utils/otpHttp';
import { decryptPii } from '~/utils/piiCrypto';

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
    throwOtpHttpError(error, event);
  }

  const oldPayload = verified.challenge.payload;
  const rawNewEmail =
    oldPayload && typeof oldPayload === 'object' && !Array.isArray(oldPayload)
      ? (oldPayload as { newEmail?: unknown }).newEmail
      : null;
  if (typeof rawNewEmail !== 'string') {
    throw createError({ statusCode: 400, message: 'Invalid email change flow' });
  }
  const newEmail = normalizeEmail(decryptPii(rawNewEmail));

  const existing = await findUserByEmail(newEmail);
  if (existing) throw createError({ statusCode: 409, message: 'Email is already registered' });

  try {
    const next = await createOtpChallenge({
      purpose: 'email_change_new',
      email: newEmail,
      userId: session.user,
      payload: { oldChallengeId: verified.challenge.id },
      event,
      template: 'email-change-new-otp',
    });

    return {
      ...next,
    };
  } catch (error) {
    throwOtpHttpError(error, event);
  }
});
