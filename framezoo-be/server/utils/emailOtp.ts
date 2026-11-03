import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import type { H3Event } from 'h3';
import type { Prisma } from '../../generated/prisma/client';
import { prisma } from './prisma';
import { normalizeEmail } from './accountIdentifier';

export const OTP_EXPIRY_MS = 10 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
const OTP_IP_WINDOW_MS = 15 * 60 * 1000;
const OTP_IP_MAX_REQUESTS = 10;
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
} as const;
type OtpErrorCode = keyof typeof _OTP_ERROR_CODES;

export type OtpPurpose =
  'registration' | 'password_reset' | 'password_change' | 'email_change_old' | 'email_change_new';

export class OtpError extends Error {
  public readonly code: OtpErrorCode;

  constructor(message: string, code: OtpErrorCode) {
    super(message);
    this.code = code;
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

const getRequestIp = (event: H3Event): string =>
  getRequestIP(event, {
    xForwardedFor: String(process.env.TRUST_PROXY).toLowerCase() === 'true',
  }) || '127.0.0.1';

export async function createOtpChallenge(options: {
  purpose: OtpPurpose;
  email: string;
  userId?: string;
  payload?: Prisma.InputJsonObject;
  event?: H3Event;
  isResend?: boolean;
  send: (code: string) => Promise<void>;
}): Promise<OtpChallengeResponse> {
  const email = normalizeEmail(options.email);
  const now = new Date();
  const requestIp = options.event ? getRequestIp(options.event) : undefined;
  const latest = await prisma.email_otp_challenges.findFirst({
    where: {
      email,
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
    throw new OtpError('Please wait before requesting another code', 'cooldown');
  }

  if (requestIp) {
    const ipRequestCount = await prisma.email_otp_challenges.count({
      where: {
        purpose: options.purpose,
        request_ip: requestIp,
        created_at: { gt: new Date(now.getTime() - OTP_IP_WINDOW_MS) },
      },
    });
    if (ipRequestCount >= OTP_IP_MAX_REQUESTS) {
      throw new OtpError('Too many verification requests', 'locked');
    }
  }

  await prisma.email_otp_challenges.updateMany({
    where: { email, purpose: options.purpose, consumed_at: null },
    data: { consumed_at: now },
  });

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const challenge = await prisma.email_otp_challenges.create({
    data: {
      purpose: options.purpose,
      email,
      user_id: options.userId,
      payload: options.payload,
      code_hash: hashCode(options.purpose, email, code),
      expires_at: new Date(now.getTime() + OTP_EXPIRY_MS),
      max_attempts: OTP_MAX_ATTEMPTS,
      last_sent_at: options.isResend ? now : null,
      request_ip: requestIp,
    },
  });

  try {
    await options.send(code);
  } catch {
    await prisma.email_otp_challenges.update({
      where: { id: challenge.id },
      data: { consumed_at: new Date() },
    });
    throw new OtpError('Unable to send verification email', 'smtp');
  }

  return {
    challengeId: challenge.id,
    expiresIn: Math.floor(OTP_EXPIRY_MS / 1000),
    resendAfter: options.isResend ? Math.floor(OTP_RESEND_COOLDOWN_MS / 1000) : 0,
  };
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
  if (options.userId && challenge.user_id !== options.userId) {
    throw new OtpError('Invalid verification code', 'invalid');
  }
  if (options.email && challenge.email !== normalizeEmail(options.email)) {
    throw new OtpError('Invalid verification code', 'invalid');
  }
  if (challenge.consumed_at) throw new OtpError('Verification code already used', 'consumed');
  if (challenge.verified_at) throw new OtpError('Verification code already used', 'consumed');
  if (challenge.expires_at <= now) throw new OtpError('Verification code expired', 'expired');
  if (challenge.attempts >= challenge.max_attempts) {
    throw new OtpError('Too many invalid attempts', 'locked');
  }

  const expected = hashCode(options.purpose, challenge.email, options.code.trim());
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
  send: (purpose: OtpPurpose, email: string, code: string) => Promise<void>;
}): Promise<OtpChallengeResponse> {
  const challenge = await prisma.email_otp_challenges.findUnique({
    where: { id: options.challengeId },
  });
  if (!challenge || challenge.consumed_at || challenge.verified_at) {
    throw new OtpError('Verification code is no longer available', 'expired');
  }

  return createOtpChallenge({
    purpose: challenge.purpose as OtpPurpose,
    email: challenge.email,
    userId: challenge.user_id ?? undefined,
    payload: challenge.payload as Prisma.InputJsonObject | undefined,
    event: options.event,
    isResend: true,
    send: code => options.send(challenge.purpose as OtpPurpose, challenge.email, code),
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
