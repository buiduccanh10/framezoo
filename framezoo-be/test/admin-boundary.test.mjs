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
  assert.match(nginx, /resolver 127\.0\.0\.11/);
  assert.match(nginx, /proxy_pass \$framezoo_be;/);
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

test('feedback attachments stay bounded, private, and are cleaned up on deletion', () => {
  const post = read('server/api/feedback/index.post.ts');
  const storage = read('server/utils/feedback-storage.ts');
  const attachment = read('server/api/feedback/[id]/attachments/[key].get.ts');
  const deletion = read('server/api/feedback/[id].delete.ts');
  const apiProxy = fs.readFileSync(new URL('../../ops/nginx-proxy/vhost.d/api.framezoo.top', import.meta.url), 'utf8');
  const compose = fs.readFileSync(new URL('../../docker-compose.prod.yml', import.meta.url), 'utf8');

  assert.match(storage, /MAX_FEEDBACK_FILE_BYTES = 55 \* 1024 \* 1024/);
  assert.match(storage, /hasFileSignature/);
  assert.match(storage, /hasSafeContainer/);
  assert.match(storage, /FeedbackMalwareError/);
  assert.match(storage, /zINSTREAM/);
  assert.match(storage, /FEEDBACK_CLAMAV_REQUIRED/);
  assert.match(storage, /FEEDBACK_STORAGE_DIR/);
  assert.match(storage, /mode: 0o600/);
  assert.match(post, /readMultipartFormData\(event\)/);
  assert.match(attachment, /await requireAdmin\(event\)/);
  assert.match(deletion, /removeFeedbackAttachments\(attachments\)/);
  assert.match(apiProxy, /client_max_body_size 60m/);
  assert.match(compose, /feedback-storage:\/data\/feedback/);
  assert.match(compose, /clamav:1\.4\.6@sha256:/);
  assert.match(compose, /FEEDBACK_CLAMAV_REQUIRED/);
  assert.match(compose, /FRESHCLAM_CHECKS/);
  assert.match(compose, /CLAMD_CONF_ConcurrentDatabaseReload/);
});

test('admin user surfaces minimize legal/privacy PII and track app_version', () => {
  const emailOtp = read('server/utils/emailOtp.ts');
  const userDetail = read('server/api/admin/users/[id].get.ts');
  const userList = read('server/api/admin/users/index.get.ts');
  const auth = read('server/utils/auth.ts');
  const cors = read('server/utils/cors.ts');

  assert.match(emailOtp, /request_ip:\s*null/);
  assert.doesNotMatch(userDetail, /public_key|watch_history|bookmarks|progress_items|addons/);
  assert.match(userDetail, /summarizeClientPlatform/);
  assert.match(userDetail, /app_version/);
  assert.match(userList, /app_version/);
  assert.match(userList, /last_active/);
  assert.match(userList, /expires_at/);
  assert.doesNotMatch(userList, /public_key|watch_history|bookmarks|progress_items|addons/);
  assert.match(auth, /x-app-version/);
  assert.match(cors, /X-App-Version/);
});

test('guest feedback requires valid email or phone contact while logged-in users do not', async () => {
  const feedbackPost = read('server/api/feedback/index.post.ts');
  const feedbackGet = read('server/api/feedback/index.get.ts');
  const storage = read('server/utils/feedback-storage.ts');

  assert.match(feedbackPost, /!userId && !contact/);
  assert.match(feedbackPost, /isValidFeedbackContact\(contact\)/);
  assert.match(feedbackGet, /contact:\s*decryptPiiOrNull\(f\.contact\)/);
  assert.match(storage, /EMAIL_CONTACT_REGEX/);
  assert.match(storage, /PHONE_CONTACT_REGEX/);
});
