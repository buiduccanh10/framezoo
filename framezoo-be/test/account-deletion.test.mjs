import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('self-service deletion covers account-linked tables and preserves support reports without a user link', () => {
  const schema = read('prisma/schema.prisma');
  const route = read('server/routes/users/[id]/index.ts');
  const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
    .filter(([, name, body]) =>
      name !== 'users' &&
      (/^\s+user_id\s+String/m.test(body) ||
        (name === 'sessions' && /^\s+user\s+String/m.test(body)) ||
        name === 'user_settings'),
    )
    .map(([, name]) => name);

  for (const model of models) {
    const operation = model === 'feedbacks' ? 'updateMany' : 'deleteMany';
    assert.match(route, new RegExp(`tx\\.${model}\\.${operation}\\(`), `${model} is not handled`);
  }
  assert.match(route, /tx\.email_outbox\.deleteMany\(/);
  assert.match(route, /tx\.otp_idempotency_keys\.deleteMany\(/);
  assert.match(route, /tx\.feedbacks\.updateMany\([\s\S]*?user_id: null/);
  assert.doesNotMatch(route, /\.catch\(\(\) => \{\}\)/);
});

test('expired email verification data has daily cleanup', () => {
  const cleanup = read('server/tasks/jobs/cleanup-email.ts');
  const schedule = read('nitro.config.ts');
  assert.match(cleanup, /email_otp_challenges\.deleteMany/);
  assert.match(cleanup, /email_outbox\.deleteMany/);
  assert.match(schedule, /'0 3 \* \* \*': \['backup:daily', 'jobs:cleanup-email'\]/);
});
