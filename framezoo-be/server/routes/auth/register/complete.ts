import { z } from 'zod';
import { useChallenge } from '~/utils/challenge';
import { useAuth } from '~/utils/auth';
import { randomUUID } from 'crypto';
import { normalizeEmail } from '~/utils/accountIdentifier';
import { encryptPii, hashEmailIndex } from '~/utils/piiCrypto';
import { verifyOtp } from '~/utils/emailOtp';
import { sendEmail } from '~/utils/email';
import { throwOtpHttpError } from '~/utils/otpHttp';

const legalConsentSchema = z.object({
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'Terms of Service acceptance is required' }),
  }),
  acceptedPrivacy: z.literal(true, {
    errorMap: () => ({ message: 'Privacy Policy acceptance is required' }),
  }),
  ageConfirmed: z.literal(true, {
    errorMap: () => ({ message: 'You must confirm you are at least 16 years old' }),
  }),
  termsVersion: z.string().trim().min(1).max(32),
  privacyVersion: z.string().trim().min(1).max(32),
  platform: z.enum(['web', 'desktop', 'mobile', 'tv']),
});

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
  emailOtp: z.object({
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
  }),
  legalConsent: legalConsentSchema,
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

  try {
    await verifyOtp({
      challengeId: input.emailOtp.challengeId,
      code: input.emailOtp.code,
      purpose: 'registration',
      consume: true,
      email: input.email,
    });
  } catch (error) {
    throwOtpHttpError(error, event);
  }

  const challenge = useChallenge();
  try {
    const challengeArguments = [
      input.challenge.code,
      input.publicKey,
      input.challenge.signature,
      'registration',
      'mnemonic',
    ] as const;
    await challenge.verifyChallengeCode(...challengeArguments);
  } catch (err: unknown) {
    throw createError({
      statusCode: 400,
      message: err instanceof Error ? err.message : 'Invalid challenge',
    });
  }

  const nickname = input.nickname;
  const email = normalizeEmail(input.email);
  const emailHash = hashEmailIndex(email);

  // Both fields have unique B-tree indexes. Keep these as two indexed lookups
  // instead of an OR/insensitive scan so the check remains O(log n) as users grow.
  const [existingNickname, existingEmail] = await Promise.all([
    prisma.users.findUnique({
      where: { nickname },
      select: { id: true },
    }),
    prisma.users.findUnique({
      where: { email_hash: emailHash },
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
    user = await prisma.$transaction(async tx => {
      // shortcut: latest legal consent lives on users row; extract an append-only consent_logs table if legal versions need audit history.
      const createdUser = await tx.users.create({
        data: {
          id: userId,
          namespace: input.namespace,
          public_key: input.publicKey,
          nickname,
          email: encryptPii(email),
          email_hash: emailHash,
          created_at: now,
          last_logged_in: now,
          email_verified_at: now,
          permissions: [],
          profile: input.profile,
          terms_version: input.legalConsent.termsVersion,
          privacy_version: input.legalConsent.privacyVersion,
          consented_at: now,
          consent_platform: input.legalConsent.platform,
          age_confirmed: true,
        },
      });

      await tx.user_settings.upsert({
        where: { id: createdUser.id },
        update: {},
        create: {
          id: createdUser.id,
          application_theme: 'ember',
        },
      });

      return createdUser;
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

  try {
    await sendEmail({
      to: email,
      template: 'welcome',
      nickname,
    });
  } catch (error) {
    console.error('Failed to send registration welcome email:', error);
  }

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
      nickname: user.nickname,
      profile: user.profile,
      permissions: user.permissions,
      email,
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
