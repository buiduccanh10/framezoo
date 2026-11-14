import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const { extractAppVersionFromHeaders, resolveSessionClientUpdate } = await import(
  '../server/utils/clientVersion.ts'
);

test('extractAppVersionFromHeaders prioritizes valid X-App-Version over User-Agent and rejects invalid tokens', () => {
  assert.equal(
    extractAppVersionFromHeaders(' 2.3.0 ', 'Mozilla/5.0 Framezoo/2.1.0 Electron/42'),
    '2.3.0'
  );
  assert.equal(
    extractAppVersionFromHeaders('invalid version with spaces', 'Mozilla/5.0 Framezoo/2.2.6 Electron/42'),
    '2.2.6'
  );
  assert.equal(extractAppVersionFromHeaders('', 'Mozilla/5.0 Chrome/120.0.0.0'), null);
});

test('resolveSessionClientUpdate uses live request headers instead of stale DB session user_agent', () => {
  const upgraded = resolveSessionClientUpdate({
    headerAppVersion: undefined,
    requestUserAgent: 'Mozilla/5.0 Framezoo/2.2.6 Electron/42.8.1 Mac',
    storedAppVersion: '2.1.7',
    storedUserAgent: 'Mozilla/5.0 Framezoo/2.1.7 Electron/42.8.1 Mac',
  });

  assert.deepEqual(upgraded, {
    detectedVersion: '2.2.6',
    nextVersion: '2.2.6',
    nextUserAgent: 'Mozilla/5.0 Framezoo/2.2.6 Electron/42.8.1 Mac',
  });

  const unchanged = resolveSessionClientUpdate({
    headerAppVersion: '2.2.6',
    requestUserAgent: 'Mozilla/5.0 Framezoo/2.2.6 Electron/42.8.1 Mac',
    storedAppVersion: '2.2.6',
    storedUserAgent: 'Mozilla/5.0 Framezoo/2.2.6 Electron/42.8.1 Mac',
  });

  assert.deepEqual(unchanged, {
    detectedVersion: '2.2.6',
    nextVersion: undefined,
    nextUserAgent: undefined,
  });

  const noVersionHeader = resolveSessionClientUpdate({
    headerAppVersion: undefined,
    requestUserAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
    storedAppVersion: '2.2.6',
    storedUserAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
  });

  assert.deepEqual(noVersionHeader, {
    detectedVersion: null,
    nextVersion: undefined,
    nextUserAgent: undefined,
  });
});

test('auth and admin routes wire live version updates across token bump, refresh, and admin views', () => {
  const auth = fs.readFileSync(new URL('../server/utils/auth.ts', import.meta.url), 'utf8');
  const tokenRoute = fs.readFileSync(
    new URL('../server/routes/oauth/token.post.ts', import.meta.url),
    'utf8'
  );
  const adminUsers = fs.readFileSync(
    new URL('../server/api/admin/users/index.get.ts', import.meta.url),
    'utf8'
  );
  const adminUserDetail = fs.readFileSync(
    new URL('../server/api/admin/users/[id].get.ts', import.meta.url),
    'utf8'
  );

  assert.match(auth, /getSessionAndBump\(payload\.sid, event\)/);
  assert.match(auth, /rotateRefreshToken\(refreshToken, \{ rotate: false, event \}\)/);
  assert.match(auth, /syncUserAppVersion\(session\.user, nextVersion\)/);
  assert.match(tokenRoute, /rotateRefreshToken\(token, \{ rotate: true, event \}\)/);
  assert.match(
    adminUsers,
    /COALESCE\(sa\.latest_session_version, NULLIF\(u\.app_version, ''\)\)/
  );
  assert.match(
    adminUserDetail,
    /sessionsList\.find\(s => s\.app_version\)\?\.app_version \|\| user\.app_version/
  );
});
