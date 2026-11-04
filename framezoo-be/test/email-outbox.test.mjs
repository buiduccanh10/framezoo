import assert from 'node:assert/strict';
import test from 'node:test';

process.env.CRYPTO_SECRET = 'otp-test-secret';

const { decryptEmailPayload, encryptEmailPayload } = await import(
  '../server/utils/emailOutbox.ts'
);

test('email outbox payload encrypts and decrypts without exposing the OTP', () => {
  const payload = {
    to: 'user@example.com',
    template: 'registration-otp',
    code: '123456',
  };
  const encrypted = encryptEmailPayload(payload);

  assert.notEqual(encrypted, JSON.stringify(payload));
  assert.deepEqual(decryptEmailPayload(encrypted), payload);
  assert.throws(() => decryptEmailPayload(`${encrypted}x`));
});
