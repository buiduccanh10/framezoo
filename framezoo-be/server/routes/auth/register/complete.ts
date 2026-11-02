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
  nickname: z.string().trim().min(1).max(255),
  email: z.string().trim().email().max(255),
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

  const input = result.data;

  const challenge = useChallenge();
  try {
    await challenge.verifyChallengeCode(
      input.challenge.code,
      input.publicKey,
      input.challenge.signature,
      'registration',
      'mnemonic'
    );
  } catch (err: any) {
    throw createError({
      statusCode: 400,
      message: err.message || 'Invalid challenge',
    });
  }

  const nickname = input.nickname;
  const email = normalizeEmail(input.email);

  // Both fields have unique B-tree indexes. Keep these as two indexed lookups
  // instead of an OR/insensitive scan so the check remains O(log n) as users grow.
  const [existingNickname, existingEmail] = await Promise.all([
    prisma.users.findUnique({
      where: { nickname },
      select: { id: true },
    }),
    prisma.users.findUnique({
      where: { email },
      select: { id: true },
    }),
  ]);

  if (existingNickname) {
    throw createError({
      statusCode: 409,
      message: 'Nickname is already taken',
    });
  }

  if (existingEmail) {
    throw createError({
      statusCode: 409,
      message: 'Email is already registered',
    });
  }

  const userId = randomUUID();
  const now = new Date();

  let user;
  try {
    user = await prisma.users.create({
      data: {
        id: userId,
        namespace: input.namespace,
        public_key: input.publicKey,
        nickname,
        email,
        created_at: now,
        last_logged_in: now,
        permissions: [],
        profile: input.profile,
      } as any,
    });
  } catch (error) {
    // The pre-check is only an early response. The unique indexes remain the
    // authority when concurrent registrations race between check and insert.
    if (isUniqueConstraintError(error)) {
      throw createError({
        statusCode: 409,
        message: 'Nickname or email is already registered',
      });
    }
    throw error;
  }

  // Ensure default settings exist for new users (theme defaults to amber)
  await prisma.user_settings.upsert({
    where: { id: user.id },
    update: {},
    create: {
      id: user.id,
      application_theme: 'ember',
    },
  });

  const auth = useAuth();
  const userAgent = getRequestHeader(event, 'user-agent');
  const session = await auth.makeSession(user.id, input.device, userAgent);
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

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
