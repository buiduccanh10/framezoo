import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relativePath =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('admin boundary keeps sessions server-side and out of browser URLs', () => {
  const admin = read('server/utils/admin.ts');
  const login = read('server/api/backup/login.post.ts');
  const rateLimit = read('server/middleware/a-rate-limit.ts');
  const client = fs.readFileSync(
    new URL('../../framezoo-admin/src/lib/api.ts', import.meta.url),
    'utf8',
  );
  const authHook = fs.readFileSync(
    new URL('../../framezoo-admin/src/hooks/useAdminAuth.ts', import.meta.url),
    'utf8',
  );
  const nginx = fs.readFileSync(
    new URL('../../framezoo-admin/nginx.conf', import.meta.url),
    'utf8',
  );
  const productionCompose = fs.readFileSync(
    new URL('../../docker-compose.prod.yml', import.meta.url),
    'utf8',
  );
  const edgeVhost = fs.readFileSync(
    new URL('../../ops/nginx-proxy/vhost.d/admin.framezoo.top', import.meta.url),
    'utf8',
  );

  assert.match(admin, /randomBytes/);
  assert.match(admin, /useStorage\('cache'\)/);
  assert.match(admin, /x-admin-request/);
  assert.doesNotMatch(admin, /getHeader\(event, ['"]Authorization/);
  assert.match(login, /httpOnly: true/);
  assert.match(login, /sameSite: 'strict'/);
  assert.doesNotMatch(login, /return\s*\{[^}]*token/s);
  assert.match(rateLimit, /scope: 'admin-login'/);
  assert.doesNotMatch(client, /localStorage|\?token=/);
  assert.match(nginx, /Content-Security-Policy/);
  assert.match(nginx, /X-Frame-Options "DENY"/);
  assert.match(productionCompose, /VIRTUAL_HOST=admin\.framezoo\.top[\s\S]*HTTPS_METHOD=redirect/);
  assert.match(edgeVhost, /Strict-Transport-Security/);
  assert.match(authHook, /await adminApi\.logout\(\);\s*setAuthState\(['"]anonymous['"]\)/s);
  assert.doesNotMatch(authHook, /setAuthState\(['"]anonymous['"]\);\s*try\s*\{/s);
});

test('admin list routes clamp pagination and return metadata', () => {
  const feedback = read('server/api/feedback/index.get.ts');
  const backupRoute = read('server/api/backup/files.get.ts');
  const backup = read('server/utils/backup.ts');

  assert.match(feedback, /getQuery\(event\)/);
  assert.match(feedback, /skip: \(page - 1\) \* limit/);
  assert.match(feedback, /take: limit/);
  assert.match(feedback, /pagination: \{ page, limit, total, totalPages/);
  assert.match(backupRoute, /getQuery\(event\)/);
  assert.match(backupRoute, /getBackupFiles\(page, limit\)/);
  assert.match(backup, /backupFiles\.slice\(start, start \+ safeLimit\)/);
});
