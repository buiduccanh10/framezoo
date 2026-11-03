import { z } from 'zod';
import { prisma } from '~/utils/prisma';
import { useAuth } from '~/utils/auth';
import { consumeActionToken, getChallengeUserId } from '~/utils/emailOtp';
import { throwOtpHttpError } from '~/utils/otpHttp';
import { isValidPublicKey } from '~/utils/publicKey';

const schema = z.object({
  actionToken: z.string().min(40).max(200),
  newPublicKey: z.string().refine(isValidPublicKey, 'Invalid public key'),
  device: z.string().max(500).min(1),
});

export default defineEventHandler(async event => {
  const result = schema.safeParse(await readBody(event));
  if (!result.success) {
    throw createError({ statusCode: 400, message: 'Invalid request body' });
  }

  let challenge;
  try {
    challenge = await consumeActionToken({
      actionToken: result.data.actionToken,
      purpose: 'password_reset',
    });
  } catch (error) {
    throwOtpHttpError(error);
  }

  const userId = getChallengeUserId(challenge);
  const user = await prisma.users.findUnique({ where: { id: userId } });
  if (!user) throw createError({ statusCode: 404, message: 'User cannot be found' });

  const auth = useAuth();
  const userAgent = getRequestHeader(event, 'user-agent') || '';
  await prisma.$transaction(async tx => {
    await tx.users.update({
      where: { id: user.id },
      data: { public_key: result.data.newPublicKey },
    });
    await tx.sessions.deleteMany({ where: { user: user.id } });
  });
  const session = await auth.makeSession(user.id, result.data.device, userAgent);

  const { session: hydratedSession, tokens } = await auth.issueTokensForSession(session);
  auth.setAuthCookies(event, tokens);

  return {
    user: {
      id: user.id,
      publicKey: result.data.newPublicKey,
      namespace: user.namespace,
      profile: user.profile,
      permissions: user.permissions,
      nickname: user.nickname,
      email: user.email,
    },
    session: {
      id: hydratedSession.id,
      user: hydratedSession.user,
      createdAt: hydratedSession.created_at,
      accessedAt: hydratedSession.accessed_at,
      expiresAt: hydratedSession.expires_at,
      device: hydratedSession.device,
      userAgent: hydratedSession.user_agent,
    },
    oauth: auth.toOAuthTokenResponse(tokens),
  };
});
