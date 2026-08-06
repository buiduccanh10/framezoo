import { z } from 'zod';
import { useChallenge } from '~/utils/challenge';
import { useAuth } from '~/utils/auth';
import { findUserByAccountIdentifier } from '~/utils/accountIdentifier';

const completeSchema = z.object({
  identifier: z.string().min(1).max(255).optional(),
  nickname: z.string().min(1).max(255).optional(),
  publicKey: z.string(),
  challenge: z.object({
    code: z.string(),
    signature: z.string(),
  }),
  device: z.string().max(500).min(1),
}).refine((value) => value.identifier || value.nickname || value.publicKey, {
  message: 'Account identifier is required',
});

export default defineEventHandler(async event => {
  const body = await readBody(event);

  const result = completeSchema.safeParse(body);
  if (!result.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
    });
  }

  const user = await findUserByAccountIdentifier(
    body.identifier ?? body.nickname ?? body.publicKey,
    body.publicKey,
  );

  if (!user) {
    throw createError({
      statusCode: 401,
      message: 'User cannot be found',
    });
  }

  // Verify challenge with the public key from database
  const challenge = useChallenge();
  try {
    await challenge.verifyChallengeCode(
      body.challenge.code,
      user.public_key,
      body.challenge.signature,
      'login',
      'mnemonic'
    );
  } catch (err: any) {
    throw createError({
      statusCode: 401,
      message: err.message || 'Invalid signature',
    });
  }

  // Update last logged in
  await prisma.users.update({
    where: { id: user.id },
    data: { last_logged_in: new Date() },
  });

  const auth = useAuth();
  const userAgent = getRequestHeader(event, 'user-agent') || '';
  const session = await auth.makeSession(user.id, body.device, userAgent);
  const { session: hydratedSession, tokens } = await auth.issueTokensForSession(session);
  auth.setAuthCookies(event, tokens);

  return {
    user: {
      id: user.id,
      publicKey: user.public_key,
      namespace: user.namespace,
      profile: user.profile,
      permissions: user.permissions,
      nickname: (user as any).nickname,
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
