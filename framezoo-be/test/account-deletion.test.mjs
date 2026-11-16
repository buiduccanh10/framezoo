import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('self-service and admin deletion cover account-linked tables and preserve support reports without a user link', () => {
  const schema = read('prisma/schema.prisma');
  const deletionHelper = read('server/utils/accountDeletion.ts');
  const selfDeleteRoute = read('server/routes/users/[id]/index.ts');
  const adminDeleteRoute = read('server/api/admin/users/[id].delete.ts');
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
    assert.match(deletionHelper, new RegExp(`tx\\.${model}\\.${operation}\\(`), `${model} is not handled`);
  }
  assert.match(deletionHelper, /tx\.email_outbox\.deleteMany\(/);
  assert.match(deletionHelper, /tx\.otp_idempotency_keys\.deleteMany\(/);
  assert.match(deletionHelper, /tx\.feedbacks\.updateMany\([\s\S]*?user_id: null/);
  assert.match(deletionHelper, /progress_queue:\$\{userId\}:/);
  assert.doesNotMatch(deletionHelper, /\.catch\(\(\) => \{\}\)/);
  assert.match(selfDeleteRoute, /deleteUserAccountData\(userId\)/);
  assert.match(selfDeleteRoute, /clearSessionCookie\(event\)/);
  assert.match(adminDeleteRoute, /deleteUserAccountData\(userId\)/);

  const syncProgress = read('server/tasks/jobs/sync-progress.ts');
  assert.match(syncProgress, /prisma\.users\.findUnique/);
  assert.match(syncProgress, /if \(!userExists\)/);
});

test('expired email verification and guest tracking data have daily cleanup', () => {
  const cleanup = read('server/tasks/jobs/cleanup-email.ts');
  const guestCleanup = read('server/tasks/jobs/cleanup-guests.ts');
  const schedule = read('nitro.config.ts');
  assert.match(cleanup, /email_otp_challenges\.deleteMany/);
  assert.match(cleanup, /email_outbox\.deleteMany/);
  assert.match(guestCleanup, /guests\.deleteMany/);
  assert.match(schedule, /'0 3 \* \* \*': \['backup:daily', 'jobs:cleanup-email'\]/);
  assert.match(schedule, /'0 4 \* \* \*': \['jobs:cleanup-guests'\]/);
});
