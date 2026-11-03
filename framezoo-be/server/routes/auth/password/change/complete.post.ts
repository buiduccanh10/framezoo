import { z } from 'zod';
import { prisma } from '~/utils/prisma';
import { useAuth } from '~/utils/auth';
import { verifyOtp } from '~/utils/emailOtp';
import { throwOtpHttpError } from '~/utils/otpHttp';
import { isValidPublicKey } from '~/utils/publicKey';

const schema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
  newPublicKey: z.string().refine(isValidPublicKey, 'Invalid public key'),
  device: z.string().max(500).min(1),
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
    await verifyOtp({
      challengeId: result.data.challengeId,
      code: result.data.code,
      purpose: 'password_change',
      consume: true,
      userId: session.user,
    });
  } catch (error) {
    throwOtpHttpError(error);
  }

  await prisma.$transaction(async tx => {
    await tx.users.update({
      where: { id: session.user },
      data: { public_key: result.data.newPublicKey },
    });
    await tx.sessions.deleteMany({
      where: { user: session.user, id: { not: session.id } },
    });
    await tx.sessions.update({
      where: { id: session.id },
      data: { device: result.data.device },
    });
  });

  const user = await prisma.users.findUnique({ where: { id: session.user } });
  if (!user) throw createError({ statusCode: 404, message: 'User cannot be found' });

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
    session: {
      id: session.id,
      user: session.user,
      createdAt: session.created_at,
      accessedAt: session.accessed_at,
      expiresAt: session.expires_at,
      device: session.device,
      userAgent: session.user_agent,
    },
  };
});
