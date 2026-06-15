import { z } from 'zod';
import { useChallenge } from '~/utils/challenge';
import { useAuth } from '~/utils/auth';
import { randomUUID } from 'crypto';

const completeSchema = z.object({
  publicKey: z.string(),
  challenge: z.object({
    code: z.string(),
    signature: z.string(),
  }),
  namespace: z.string().min(1),
  device: z.string().max(500).min(1),
  nickname: z.string().min(1).max(255),
  inviteCode: z.string().min(1),
  profile: z.object({
    colorA: z.string(),
    colorB: z.string(),
    icon: z.string(),
  }),
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

  const challenge = useChallenge();
  await challenge.verifyChallengeCode(
    body.challenge.code,
    body.publicKey,
    body.challenge.signature,
    'registration',
    'mnemonic'
  );

  // Check if nickname is already taken
  const existingNickname = await prisma.users.findUnique({
    where: { nickname: body.nickname },
  });

  if (existingNickname) {
    throw createError({
      statusCode: 409,
      message: 'Nickname is already taken',
    });
  }

  // Verify invite code (inviter user id)
  const inviter = await prisma.users.findUnique({
    where: { id: body.inviteCode },
  });

  if (!inviter) {
    throw createError({
      statusCode: 400,
      message: 'Invalid invite code: User does not exist',
    });
  }

  const userId = randomUUID();
  const now = new Date();

  const user = await prisma.users.create({
    data: {
      id: userId,
      namespace: body.namespace,
      public_key: body.publicKey,
      nickname: body.nickname,
      created_at: now,
      last_logged_in: now,
      permissions: [],
      profile: body.profile,
      invited_by: inviter.id,
    } as any,
  });

  // Ensure default settings exist for new users (theme defaults to amber)
  await prisma.user_settings.upsert({
    where: { id: user.id },
    update: {},
    create: {
      id: user.id,
      proxy_urls: [],
      application_theme: 'ember',
    },
  });

  const auth = useAuth();
  const userAgent = getRequestHeader(event, 'user-agent');
  const session = await auth.makeSession(user.id, body.device, userAgent);
  const { session: hydratedSession, tokens } = await auth.issueTokensForSession(session);
  auth.setAuthCookies(event, tokens);

  return {
    user: {
      id: user.id,
      publicKey: user.public_key,
      namespace: user.namespace,
      nickname: (user as any).nickname,
      profile: user.profile,
      permissions: user.permissions,
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
