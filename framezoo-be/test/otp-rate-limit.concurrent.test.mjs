import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import process from 'node:process';
import test from 'node:test';
import Redis from 'ioredis';

if (typeof registerHooks === 'function') {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        (specifier.startsWith('./') || specifier.startsWith('../')) &&
        !/\.[a-z]+$/i.test(specifier) &&
        context.parentURL?.startsWith('file:')
      ) {
        const candidate = new URL(`${specifier}.ts`, context.parentURL);
        if (fs.existsSync(candidate)) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
      return nextResolve(specifier, context);
    },
  });
}

const redisUrl = process.env.TEST_REDIS_URL;

test('OTP rate limit allows one concurrent request per email cooldown', { skip: !redisUrl }, async () => {
  process.env.REDIS_URL = redisUrl;
  process.env.OTP_COOLDOWN_WINDOW_MS = '1000';

  const { closeOtpRateLimit, enforceOtpRateLimit } = await import(
    '../server/utils/otpRateLimit.ts'
  );
  const email = `otp-load-${randomUUID()}@example.com`;
  const purpose = 'concurrency-test';
  const ip = '198.51.100.88';
  const digest = value => createHash('sha256').update(value).digest('hex');
  const keys = [
    `otp:limit:cooldown:${digest(purpose)}:${digest(email)}`,
    `otp:limit:email:${digest(purpose)}:${digest(email)}`,
    `otp:limit:ip:${digest(ip)}`,
  ];
  const redis = new Redis(redisUrl);

  try {
    const results = await Promise.all(
      Array.from({ length: 100 }, () => enforceOtpRateLimit({ email, purpose, ip }))
    );
    assert.equal(results.filter(result => result.allowed).length, 1);
    assert.equal(results.filter(result => !result.allowed).length, 99);
  } finally {
    await redis.del(...keys);
    await redis.quit();
    closeOtpRateLimit();
  }
});
