import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import type { H3Event } from 'h3';
import type { Prisma } from '../../generated/prisma/client';
import { prisma } from './prisma';
import { normalizeEmail } from './accountIdentifier';
import { decryptPii, encryptPii, hashEmailIndex, isEncryptedPii } from './piiCrypto';
import type { EmailTemplate } from './email';
import { encryptEmailPayload } from './emailOutbox';
import { enqueueEmailOutbox } from './emailQueue';
import { enforceOtpRateLimit } from './otpRateLimit';
import { scopedLogger } from './logger';

export const OTP_EXPIRY_MS = 10 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const log = scopedLogger('email-otp');
type OtpDb = Pick<typeof prisma, 'email_otp_challenges'>;
type OtpChallengeRecord = NonNullable<
  Awaited<ReturnType<typeof prisma.email_otp_challenges.findUnique>>
>;
type OtpChallengeResponse = {
  challengeId: string;
  expiresIn: number;
  resendAfter: number;
};
type ConsumedOtpVerificationResult = OtpChallengeRecord & {
  verified_at: Date;
  consumed_at: Date;
};
type ActionOtpVerificationResult = {
  actionToken: string;
  challenge: OtpChallengeRecord;
};
type OtpVerificationResult = ConsumedOtpVerificationResult | ActionOtpVerificationResult;
const _OTP_ERROR_CODES = {
  not_found: true,
  cooldown: true,
  invalid: true,
  expired: true,
  locked: true,
  consumed: true,
  smtp: true,
  idempotency_invalid: true,
  idempotency_conflict: true,
  idempotency_in_progress: true,
  rate_limit_unavailable: true,
} as const;
type OtpErrorCode = keyof typeof _OTP_ERROR_CODES;

export type OtpPurpose =
  'registration' | 'password_reset' | 'password_change' | 'email_change_old' | 'email_change_new';

export class OtpError extends Error {
  public readonly code: OtpErrorCode;
  public readonly retryAfterSeconds?: number;

  constructor(message: string, code: OtpErrorCode, retryAfterSeconds?: number) {
    super(message);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.name = 'OtpError';
  }
}

const getSecret = (): string => {
  const secret = process.env.OTP_SECRET || process.env.CRYPTO_SECRET;
  if (!secret) throw new Error('OTP_SECRET or CRYPTO_SECRET is not configured');
  return secret;
};

const hashCode = (purpose: OtpPurpose, email: string, code: string): string =>
  createHmac('sha256', getSecret()).update(`${purpose}:${email}:${code}`).digest('hex');

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const constantTimeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const getRequestIp = (event: H3Event): string =>
  getRequestIP(event, {
    xForwardedFor: String(process.env.TRUST_PROXY).toLowerCase() === 'true',
  }) || '127.0.0.1';

const getIdempotencyKey = (event?: H3Event): string | undefined => {
  const key = event ? getHeader(event, 'idempotency-key')?.trim() : undefined;
  if (!key) return undefined;
  if (key.length > 128 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new OtpError('Invalid Idempotency-Key', 'idempotency_invalid');
  }
  return key;
};

const isUniqueConstraintError = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002');

const parseStoredResponse = (value: unknown): OtpChallengeResponse | null => {
  if (!value || typeof value !== 'object') return null;
  const response = value as Partial<OtpChallengeResponse>;
  if (
    typeof response.challengeId !== 'string' ||
    typeof response.expiresIn !== 'number' ||
    typeof response.resendAfter !== 'number'
  ) {
    return null;
  }
  return response as OtpChallengeResponse;
};

export async function createOtpChallenge(options: {
  purpose: OtpPurpose;
  email: string;
  userId?: string;
  payload?: Prisma.InputJsonObject;
  event?: H3Event;
  isResend?: boolean;
  template: EmailTemplate;
}): Promise<OtpChallengeResponse> {
  const email = normalizeEmail(options.email);
  const emailHash = hashEmailIndex(email);
  const requestIp = options.event ? getRequestIp(options.event) : undefined;
  const idempotencyKey = getIdempotencyKey(options.event);
  const idempotencyScope = `${options.purpose}:${emailHash}:${options.userId || 'anonymous'}`;
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        purpose: options.purpose,
        email: emailHash,
        userId: options.userId || null,
        payload: options.payload || null,
        isResend: Boolean(options.isResend),
        template: options.template,
      })
    )
    .digest('hex');

  if (idempotencyKey) {
    const existing = await prisma.otp_idempotency_keys.findUnique({
      where: { scope_key: { scope: idempotencyScope, key: idempotencyKey } },
    });
    if (existing && existing.expires_at > new Date()) {
      if (existing.request_hash !== requestHash) {
        throw new OtpError(
          'Idempotency-Key was reused with a different request',
          'idempotency_conflict'
        );
      }
      const response = parseStoredResponse(existing.response_json);
      if (response) {
        if (options.event) setResponseStatus(options.event, 202);
        return response;
      }
      throw new OtpError('The request is still being processed', 'idempotency_in_progress');
    }
  }

  try {
    const rateLimit = await enforceOtpRateLimit({
      email,
      purpose: options.purpose,
      ip: requestIp,
      userId: options.userId,
    });
    if (!rateLimit.allowed) {
      throw new OtpError('Too many verification requests', 'locked', rateLimit.retryAfterSeconds);
    }
  } catch (error) {
    if (error instanceof OtpError) throw error;
    if (error instanceof Error && error.message === 'OTP_RATE_LIMIT_UNAVAILABLE') {
      throw new OtpError('OTP rate limiting is temporarily unavailable', 'rate_limit_unavailable');
    }
    throw error;
  }

  let response: OtpChallengeResponse;
  let outboxId: string;

  try {
    ({ response, outboxId } = await prisma.$transaction(async tx => {
      const lockKey = `otp:${idempotencyScope}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const now = new Date();

      if (idempotencyKey) {
        await tx.otp_idempotency_keys.deleteMany({
          where: {
            scope: idempotencyScope,
            key: idempotencyKey,
            expires_at: { lte: now },
          },
        });
        await tx.otp_idempotency_keys.create({
          data: {
            scope: idempotencyScope,
            key: idempotencyKey,
            request_hash: requestHash,
            expires_at: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
          },
        });
      }

      const latest = await tx.email_otp_challenges.findFirst({
        where: {
          email_hash: emailHash,
          purpose: options.purpose,
          consumed_at: null,
          expires_at: { gt: now },
        },
        orderBy: { created_at: 'desc' },
      });

      if (
        latest?.last_sent_at &&
        now.getTime() - latest.last_sent_at.getTime() < OTP_RESEND_COOLDOWN_MS
      ) {
        throw new OtpError(
          'Please wait before requesting another code',
          'cooldown',
          Math.max(
            1,
            Math.ceil(
              (OTP_RESEND_COOLDOWN_MS - (now.getTime() - latest.last_sent_at.getTime())) / 1000
            )
          )
        );
      }

      await tx.email_otp_challenges.updateMany({
        where: { email_hash: emailHash, purpose: options.purpose, consumed_at: null },
        data: { consumed_at: now },
      });

      const storedPayload: Prisma.InputJsonObject | undefined =
        options.payload &&
        typeof options.payload.newEmail === 'string' &&
        !isEncryptedPii(options.payload.newEmail)
          ? {
              ...options.payload,
              newEmail: encryptPii(normalizeEmail(options.payload.newEmail)),
            }
          : options.payload;

      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const challenge = await tx.email_otp_challenges.create({
        data: {
          purpose: options.purpose,
          email: encryptPii(email),
          email_hash: emailHash,
          user_id: options.userId,
          payload: storedPayload,
          code_hash: hashCode(options.purpose, email, code),
          expires_at: new Date(now.getTime() + OTP_EXPIRY_MS),
          max_attempts: OTP_MAX_ATTEMPTS,
          last_sent_at: now,
          // Do not persist raw client IP addresses in the database to minimize PII exposure.
          request_ip: null,
        },
      });

      const outbox = await tx.email_outbox.create({
        data: {
          challenge_id: challenge.id,
          dedupe_key: `otp:${challenge.id}`,
          payload_ciphertext: encryptEmailPayload({
            to: email,
            template: options.template,
            code,
          }),
        },
      });

      response = {
        challengeId: challenge.id,
        expiresIn: Math.floor(OTP_EXPIRY_MS / 1000),
        resendAfter: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
      };
      if (idempotencyKey) {
        await tx.otp_idempotency_keys.update({
          where: { scope_key: { scope: idempotencyScope, key: idempotencyKey } },
          data: { status: 'completed', response_json: response },
        });
      }

      return { response, outboxId: outbox.id };
    }));
  } catch (error) {
    if (idempotencyKey && isUniqueConstraintError(error)) {
      const existing = await prisma.otp_idempotency_keys.findUnique({
        where: { scope_key: { scope: idempotencyScope, key: idempotencyKey } },
      });
      const existingResponse = parseStoredResponse(existing?.response_json);
      if (existing && existing.request_hash === requestHash && existingResponse) {
        if (options.event) setResponseStatus(options.event, 202);
        return existingResponse;
      }
    }
    throw error;
  }

  try {
    await enqueueEmailOutbox(outboxId);
  } catch (error) {
    log.warn('Email outbox remains pending after queue enqueue failure', {
      evt: 'email_outbox_enqueue_failed',
      outboxId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (options.event) setResponseStatus(options.event, 202);
  return response;
}

export async function verifyOtp(options: {
  challengeId: string;
  code: string;
  purpose: OtpPurpose;
  consume: true;
  userId?: string;
  email?: string;
  db?: OtpDb;
}): Promise<ConsumedOtpVerificationResult>;
export async function verifyOtp(options: {
  challengeId: string;
  code: string;
  purpose: OtpPurpose;
  consume?: false;
  userId?: string;
  email?: string;
  db?: OtpDb;
}): Promise<ActionOtpVerificationResult>;
export async function verifyOtp(options: {
  challengeId: string;
  code: string;
  purpose: OtpPurpose;
  consume?: boolean;
  userId?: string;
  email?: string;
  db?: OtpDb;
}): Promise<OtpVerificationResult> {
  const db = options.db ?? prisma;
  const now = new Date();
  const challenge = await db.email_otp_challenges.findUnique({
    where: { id: options.challengeId },
  });

  if (challenge?.purpose !== options.purpose) {
    throw new OtpError('Invalid verification code', 'not_found');
  }
  const challengeEmail = normalizeEmail(decryptPii(challenge.email));

  if (options.userId && challenge.user_id !== options.userId) {
    throw new OtpError('Invalid verification code', 'invalid');
  }
  if (options.email && challengeEmail !== normalizeEmail(options.email)) {
    throw new OtpError('Invalid verification code', 'invalid');
  }
  if (challenge.consumed_at) throw new OtpError('Verification code already used', 'consumed');
  if (challenge.verified_at) throw new OtpError('Verification code already used', 'consumed');
  if (challenge.expires_at <= now) throw new OtpError('Verification code expired', 'expired');
  if (challenge.attempts >= challenge.max_attempts) {
    throw new OtpError('Too many invalid attempts', 'locked');
  }

  const expected = hashCode(options.purpose, challengeEmail, options.code.trim());
  if (!constantTimeEqual(expected, challenge.code_hash)) {
    const updated = await db.email_otp_challenges.updateMany({
      where: {
        id: challenge.id,
        consumed_at: null,
        verified_at: null,
        attempts: { lt: challenge.max_attempts },
      },
      data: { attempts: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new OtpError('Too many invalid attempts', 'locked');
    }
    throw new OtpError('Invalid verification code', 'invalid');
  }

  if (options.consume) {
    const consumed = await db.email_otp_challenges.updateMany({
      where: {
        id: challenge.id,
        consumed_at: null,
        verified_at: null,
        expires_at: { gt: now },
      },
      data: { verified_at: now, consumed_at: now },
    });
    if (consumed.count !== 1) throw new OtpError('Verification code already used', 'consumed');
    return { ...challenge, verified_at: now, consumed_at: now };
  }

  const actionToken = randomBytes(32).toString('base64url');
  const verified = await db.email_otp_challenges.updateMany({
    where: {
      id: challenge.id,
      consumed_at: null,
      verified_at: null,
      expires_at: { gt: now },
    },
    data: {
      verified_at: now,
      action_token_hash: hashToken(actionToken),
      action_expires_at: new Date(now.getTime() + OTP_EXPIRY_MS),
    },
  });
  if (verified.count !== 1) throw new OtpError('Verification code already used', 'consumed');

  return { actionToken, challenge };
}

export async function resendOtpChallenge(options: {
  challengeId: string;
  event?: H3Event;
  templateForPurpose: (purpose: OtpPurpose) => EmailTemplate;
}): Promise<OtpChallengeResponse> {
  const challenge = await prisma.email_otp_challenges.findUnique({
    where: { id: options.challengeId },
  });
  if (!challenge || challenge.consumed_at || challenge.verified_at) {
    throw new OtpError('Verification code is no longer available', 'expired');
  }

  const payload =
    challenge.payload && typeof challenge.payload === 'object' && !Array.isArray(challenge.payload)
      ? ({ ...challenge.payload } as Record<string, unknown>)
      : undefined;
  if (payload && typeof payload.newEmail === 'string') {
    payload.newEmail = normalizeEmail(decryptPii(payload.newEmail));
  }

  return createOtpChallenge({
    purpose: challenge.purpose as OtpPurpose,
    email: decryptPii(challenge.email),
    userId: challenge.user_id ?? undefined,
    payload: payload as Prisma.InputJsonObject | undefined,
    event: options.event,
    isResend: true,
    template: options.templateForPurpose(challenge.purpose as OtpPurpose),
  });
}

export async function consumeActionToken(options: {
  actionToken: string;
  purpose: OtpPurpose;
  db?: OtpDb;
}): Promise<OtpChallengeRecord> {
  const db = options.db ?? prisma;
  const now = new Date();
  const challenge = await db.email_otp_challenges.findFirst({
    where: {
      purpose: options.purpose,
      action_token_hash: hashToken(options.actionToken),
      verified_at: { not: null },
      consumed_at: null,
      action_expires_at: { gt: now },
    },
  });

  if (!challenge) throw new OtpError('Invalid or expired recovery token', 'invalid');

  const consumed = await db.email_otp_challenges.updateMany({
    where: { id: challenge.id, consumed_at: null },
    data: { consumed_at: now },
  });
  if (consumed.count !== 1) throw new OtpError('Recovery token already used', 'consumed');

  return challenge;
}

export async function consumeVerifiedChallenge(options: {
  challengeId: string;
  purpose: OtpPurpose;
  userId?: string;
  db?: OtpDb;
}): Promise<OtpChallengeRecord> {
  const db = options.db ?? prisma;
  const now = new Date();
  const challenge = await db.email_otp_challenges.findUnique({
    where: { id: options.challengeId },
  });

  if (
    challenge?.purpose !== options.purpose ||
    (options.userId && challenge.user_id !== options.userId) ||
    !challenge.verified_at ||
    challenge.consumed_at ||
    !challenge.action_expires_at ||
    challenge.action_expires_at <= now
  ) {
    throw new OtpError('Invalid or expired verification flow', 'invalid');
  }

  const consumed = await db.email_otp_challenges.updateMany({
    where: {
      id: challenge.id,
      verified_at: { not: null },
      consumed_at: null,
      action_expires_at: { gt: now },
    },
    data: { consumed_at: now },
  });
  if (consumed.count !== 1) {
    throw new OtpError('Verification flow already used', 'consumed');
  }

  return challenge;
}

export function getChallengeUserId(challenge: { user_id: string | null }): string {
  if (!challenge.user_id) throw new OtpError('User is required for this action', 'invalid');
  return challenge.user_id;
}
