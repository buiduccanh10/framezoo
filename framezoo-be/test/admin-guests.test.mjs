import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const {
  GUEST_CACHE_MAX_ENTRIES,
  GUEST_THROTTLE_MS,
  getGuestWindowStart,
  normalizeGuestId,
  parseGuestPlatformFilter,
  parseGuestWindow,
  reserveGuestActivityFlush,
  summarizeClientPlatform,
} = await import('../server/utils/guestUtils.ts');

test('guest window helpers compute exact 6h, 24h, 7d, and 30d boundaries', () => {
  const now = new Date('2026-11-14T12:00:00.000Z');

  assert.equal(parseGuestWindow('6h'), '6h');
  assert.equal(parseGuestWindow('24h'), '24h');
  assert.equal(parseGuestWindow('7d'), '7d');
  assert.equal(parseGuestWindow('30d'), '30d');
  assert.equal(parseGuestWindow('invalid'), '24h');

  assert.equal(
    getGuestWindowStart('6h', now).toISOString(),
    '2026-11-14T06:00:00.000Z'
  );
  assert.equal(
    getGuestWindowStart('24h', now).toISOString(),
    '2026-11-13T12:00:00.000Z'
  );
  assert.equal(
    getGuestWindowStart('7d', now).toISOString(),
    '2026-11-07T12:00:00.000Z'
  );
  assert.equal(
    getGuestWindowStart('30d', now).toISOString(),
    '2026-10-15T12:00:00.000Z'
  );
});

test('normalizeGuestId and parseGuestPlatformFilter validate inputs strictly', () => {
  assert.equal(
    normalizeGuestId('  A1B2C3D4-E5F6-4789-8012-1234567890AB '),
    'a1b2c3d4-e5f6-4789-8012-1234567890ab'
  );
  assert.equal(normalizeGuestId('not-a-uuid'), null);
  assert.equal(normalizeGuestId(''), null);
  assert.equal(normalizeGuestId(null), null);

  assert.equal(parseGuestPlatformFilter('Desktop'), 'Desktop');
  assert.equal(parseGuestPlatformFilter('Mobile'), 'Mobile');
  assert.equal(parseGuestPlatformFilter('TV'), 'TV');
  assert.equal(parseGuestPlatformFilter('Web'), 'Web');
  assert.equal(parseGuestPlatformFilter('random'), 'all');
});

test('summarizeClientPlatform classifies Desktop, Mobile, TV, and Web guests accurately', () => {
  assert.equal(
    summarizeClientPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Framezoo/2.2.6 Electron/42.8.1'),
    'macOS · Desktop'
  );
  assert.equal(
    summarizeClientPlatform('Framezoo-Mobile/1.0.0 (iPhone; iOS)'),
    'iOS · Mobile'
  );
  assert.equal(
    summarizeClientPlatform('Framezoo-Mobile/1.0.0 (Android)'),
    'Android · Mobile'
  );
  assert.equal(
    summarizeClientPlatform('Framezoo-TV/0.1.0 (Android TV 13)'),
    'Android · TV'
  );
  assert.equal(
    summarizeClientPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0'),
    'Windows · Web'
  );
});

test('reserveGuestActivityFlush coalesces burst hits, flushes version upgrades immediately, and bounds memory', () => {
  const cache = new Map();
  const guestId = 'a1b2c3d4-e5f6-4789-8012-1234567890ab';

  assert.deepEqual(
    reserveGuestActivityFlush(
      cache,
      { guestId, appVersion: '2.2.5', platform: 'macOS · Desktop' },
      1_000
    ),
    { shouldFlush: true, hitIncrement: 1 }
  );

  // Two burst calls within throttle window skip DB writes while keeping hit count delta
  assert.deepEqual(
    reserveGuestActivityFlush(
      cache,
      { guestId, appVersion: '2.2.5', platform: 'macOS · Desktop' },
      2_000
    ),
    { shouldFlush: false, hitIncrement: 0 }
  );
  assert.deepEqual(
    reserveGuestActivityFlush(
      cache,
      { guestId, appVersion: '2.2.5', platform: 'macOS · Desktop' },
      10_000
    ),
    { shouldFlush: false, hitIncrement: 0 }
  );

  // App version upgrade flushes immediately with accumulated hits (+2 skipped + 1 current)
  assert.deepEqual(
    reserveGuestActivityFlush(
      cache,
      { guestId, appVersion: '2.2.6', platform: 'macOS · Desktop' },
      12_000
    ),
    { shouldFlush: true, hitIncrement: 3 }
  );

  // Subsequent hit after throttle expiry flushes cleanly
  assert.deepEqual(
    reserveGuestActivityFlush(
      cache,
      { guestId, appVersion: '2.2.6', platform: 'macOS · Desktop' },
      12_000 + GUEST_THROTTLE_MS
    ),
    { shouldFlush: true, hitIncrement: 1 }
  );

  // Cache cap evicts oldest entry instead of growing unbounded
  for (let i = 0; i < GUEST_CACHE_MAX_ENTRIES + 5; i += 1) {
    reserveGuestActivityFlush(
      cache,
      {
        guestId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        appVersion: '1.0.0',
        platform: 'Android · TV',
      },
      100_000
    );
  }
  assert.equal(cache.size, GUEST_CACHE_MAX_ENTRIES);
});

test('guest admin route and tracking hooks enforce admin auth and minimize PII', () => {
  const adminGuests = fs.readFileSync(
    new URL('../server/api/admin/guests/index.get.ts', import.meta.url),
    'utf8'
  );
  const apiGuestPost = fs.readFileSync(
    new URL('../server/api/auth/guest.post.ts', import.meta.url),
    'utf8'
  );
  const routeGuestPost = fs.readFileSync(
    new URL('../server/routes/auth/guest.post.ts', import.meta.url),
    'utf8'
  );
  const apiAuthMiddleware = fs.readFileSync(
    new URL('../server/middleware/z-api-auth.ts', import.meta.url),
    'utf8'
  );

  assert.match(adminGuests, /await requireAdmin\(event\)/);
  assert.match(adminGuests, /h6/);
  assert.match(adminGuests, /h24/);
  assert.match(adminGuests, /d7/);
  assert.match(adminGuests, /d30/);
  assert.match(adminGuests, /getSemverOrderBySql/);
  assert.doesNotMatch(adminGuests, /\buser_agent\b|request_ip|watch_history|email/);

  assert.match(apiGuestPost, /issueGuestTokenForEvent/);
  assert.match(routeGuestPost, /issueGuestTokenForEvent/);
  assert.match(apiAuthMiddleware, /touchGuestActivityFromEvent\(event, guestPayload\.gid\)/);
});
