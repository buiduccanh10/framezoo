import { z } from 'zod';
import { useChallenge } from '~/utils/challenge';
import { useAuth } from '~/utils/auth';
import { randomUUID } from 'crypto';
import { normalizeEmail } from '~/utils/accountIdentifier';

const completeSchema = z.object({
  publicKey: z.string(),
  challenge: z.object({
    code: z.string(),
    signature: z.string(),
  }),
  namespace: z.string().min(1),
  device: z.string().max(500).min(1),
  nickname: z.string().min(1).max(255),
  email: z.string().email().max(255),
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
  try {
    await challenge.verifyChallengeCode(
      body.challenge.code,
      body.publicKey,
      body.challenge.signature,
      'registration',
      'mnemonic'
    );
  } catch (err: any) {
    throw createError({
      statusCode: 400,
      message: err.message || 'Invalid challenge',
    });
  }

  const email = normalizeEmail(body.email);

  const existingNickname = await prisma.users.findUnique({
    where: { nickname: body.nickname },
  });

  if (existingNickname) {
    throw createError({
      statusCode: 409,
      message: 'Nickname is already taken',
    });
  }

  const existingEmail = await prisma.users.findFirst({
    where: {
      email: {
        equals: email,
        mode: 'insensitive',
      },
    },
  });

  if (existingEmail) {
    throw createError({
      statusCode: 409,
      message: 'Email is already registered',
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
      email,
      created_at: now,
      last_logged_in: now,
      permissions: [],
      profile: body.profile,
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
