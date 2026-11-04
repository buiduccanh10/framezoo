import { createHash } from 'node:crypto';
import Redis from 'ioredis';

type RateLimitInput = {
  email: string;
  purpose: string;
  ip?: string;
  userId?: string;
};

type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const script = `
local blocked = 0
local blocked_ttl = 0
for i = 1, #KEYS do
  local count = tonumber(redis.call('GET', KEYS[i]) or '0')
  local max_count = tonumber(ARGV[(i - 1) * 2 + 1])
  if count >= max_count then
    blocked = i
    blocked_ttl = redis.call('PTTL', KEYS[i])
    break
  end
end
if blocked ~= 0 then
  return {0, blocked_ttl}
end
for i = 1, #KEYS do
  local count = redis.call('INCR', KEYS[i])
  local ttl = tonumber(ARGV[(i - 1) * 2 + 2])
  if count == 1 then redis.call('PEXPIRE', KEYS[i], ttl) end
end
return {1, 0}
`;

const getRedis = () => {
  const redisUrl =
    process.env.REDIS_URL ||
    `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`;
  return new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
};

let redis: Redis | null = null;
let redisConnectPromise: Promise<void> | null = null;

const getClient = () => {
  if (!redis) {
    redis = getRedis();
    redis.on('error', () => {});
  }
  return redis;
};

const ensureConnected = async (client: Redis) => {
  if (client.status === 'ready') return;
  if (!redisConnectPromise) {
    redisConnectPromise = client.connect().finally(() => {
      redisConnectPromise = null;
    });
  }
  await redisConnectPromise;
};

export const closeOtpRateLimit = () => {
  redis?.disconnect();
  redis = null;
  redisConnectPromise = null;
};

const getPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export async function enforceOtpRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  const email = digest(input.email);
  const purpose = digest(input.purpose);
  const keys = [`otp:limit:cooldown:${purpose}:${email}`, `otp:limit:email:${purpose}:${email}`];
  const args = [
    String(getPositiveInt(process.env.OTP_COOLDOWN_MAX_REQUESTS, 1)),
    String(getPositiveInt(process.env.OTP_COOLDOWN_WINDOW_MS, 60_000)),
    String(getPositiveInt(process.env.OTP_EMAIL_MAX_REQUESTS, 5)),
    String(getPositiveInt(process.env.OTP_EMAIL_WINDOW_MS, 15 * 60_000)),
  ];

  if (input.ip) {
    keys.push(`otp:limit:ip:${digest(input.ip)}`);
    args.push(
      String(getPositiveInt(process.env.OTP_IP_MAX_REQUESTS, 10)),
      String(getPositiveInt(process.env.OTP_IP_WINDOW_MS, 15 * 60_000))
    );
  }

  if (input.userId) {
    keys.push(`otp:limit:user:${digest(input.userId)}`);
    args.push(
      String(getPositiveInt(process.env.OTP_USER_MAX_REQUESTS, 10)),
      String(getPositiveInt(process.env.OTP_USER_WINDOW_MS, 15 * 60_000))
    );
  }

  try {
    const client = getClient();
    await ensureConnected(client);
    const result = (await client.eval(script, keys.length, ...keys, ...args)) as [number, number];
    const allowed = Number(result[0]) === 1;
    return {
      allowed,
      retryAfterSeconds: Math.max(1, Math.ceil(Number(result[1] || 0) / 1000)),
    };
  } catch (error) {
    closeOtpRateLimit();
    throw new Error('OTP_RATE_LIMIT_UNAVAILABLE', { cause: error });
  }
}
