import { z } from 'zod';
import { normalizeEmail } from '~/utils/accountIdentifier';
import { prisma } from '~/utils/prisma';
import { useAuth } from '~/utils/auth';
import { consumeVerifiedChallenge, verifyOtp } from '~/utils/emailOtp';
import { throwOtpHttpError } from '~/utils/otpHttp';

const schema = z.object({
  flowId: z.string().uuid(),
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

  try {
    return await prisma.$transaction(async tx => {
      const newChallenge = await verifyOtp({
        challengeId: result.data.flowId,
        code: result.data.code,
        purpose: 'email_change_new',
        userId: session.user,
        consume: true,
        db: tx,
      });
      const newEmail = normalizeEmail(newChallenge.email);
      const newPayload = newChallenge.payload;
      const oldChallengeId =
        newPayload && typeof newPayload === 'object' && !Array.isArray(newPayload)
          ? (newPayload as { oldChallengeId?: unknown }).oldChallengeId
          : null;
      if (typeof oldChallengeId !== 'string') {
        throw createError({ statusCode: 403, message: 'Invalid email change flow' });
      }
      const oldChallenge = await consumeVerifiedChallenge({
        challengeId: oldChallengeId,
        purpose: 'email_change_old',
        userId: session.user,
        db: tx,
      });
      const oldPayload = oldChallenge.payload;
      const expectedEmail =
        oldPayload && typeof oldPayload === 'object' && !Array.isArray(oldPayload)
          ? (oldPayload as { newEmail?: unknown }).newEmail
          : null;
      if (expectedEmail !== newEmail) {
        throw createError({ statusCode: 403, message: 'Invalid email change flow' });
      }

      const existing = await tx.users.findUnique({ where: { email: newEmail } });
      if (existing && existing.id !== session.user) {
        throw createError({ statusCode: 409, message: 'Email is already registered' });
      }

      const user = await tx.users.update({
        where: { id: session.user },
        data: { email: newEmail, email_verified_at: new Date() },
      });

      return {
        user: {
          id: user.id,
          publicKey: user.public_key,
          namespace: user.namespace,
          profile: user.profile,
          permissions: user.permissions,
          nickname: user.nickname,
          email: user.email,
        },
      };
    });
  } catch (error) {
    throwOtpHttpError(error);
  }
});
