import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  isSubtitleKeyProvider,
  testSubtitleProviderKey,
} from '../server/utils/subtitles/keyTest.ts';

const read = relativePath =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('ticket route generates one-time ticket and expires in 300 seconds', () => {
  const ticketRoute = read('server/routes/addon/subtitles/api/ticket.post.ts');

  assert.match(ticketRoute, /randomBytes/);
  assert.match(ticketRoute, /subtitles:ticket:/);
  assert.match(ticketRoute, /ttl: 300/);
  assert.match(ticketRoute, /addon\/subtitles\/configure\?ticket=/);
  assert.match(ticketRoute, /getCurrentSessionForEvent/);
});

test('verify route validates ticket, consumes it once, and issues 15-minute configure session', () => {
  const verifyRoute = read('server/routes/addon/subtitles/api/verify.get.ts');

  assert.match(verifyRoute, /subtitles:ticket:/);
  assert.match(verifyRoute, /storage\.removeItem\(ticketKey\)/); // Single-use consumption
  assert.match(verifyRoute, /subtitles:session:/);
  assert.match(verifyRoute, /ttl: 900/); // 15 minutes
  assert.match(verifyRoute, /getUserProviderCredential/);
  assert.match(verifyRoute, /configureToken/);
});

test('save route verifies session token and persists user wyzie key in provider credentials', () => {
  const saveRoute = read('server/routes/addon/subtitles/api/save.post.ts');

  assert.match(saveRoute, /subtitles:session:/);
  assert.match(saveRoute, /setUserProviderCredential/);
});

test('status route checks user provider credential without throwing on unauthenticated session', () => {
  const statusRoute = read('server/routes/addon/subtitles/api/status.get.ts');

  assert.match(statusRoute, /getUserProviderCredential/);
  assert.match(statusRoute, /configured:/);
  assert.match(statusRoute, /hasCustomKey:/);
});

test('subtitles search scopes credentials and keeps query keys unauthenticated-only', () => {
  const subtitlesRoute = read('server/routes/addon/subtitles/subtitles/[type]/[...id].get.ts');

  assert.match(subtitlesRoute, /getUserProviderCredential/);
  assert.match(subtitlesRoute, /queryWyzieKey/);
  assert.match(subtitlesRoute, /userWyzieKey/);
  assert.match(subtitlesRoute, /serverWyzieApiKey/);
  assert.match(subtitlesRoute, /userWyzieKey \|\| \(!authSession\?\.user \? queryWyzieKey : undefined\) \|\| serverWyzieApiKey/);
  assert.match(subtitlesRoute, /credentialSource/);
  assert.match(subtitlesRoute, /hashSubtitleCredential/);
  assert.match(subtitlesRoute, /private, no-store/);
  assert.match(subtitlesRoute, /Vary', 'Authorization, Cookie, Accept-Language/);

  const credentialLookup = subtitlesRoute.indexOf('const savedKey = await getUserProviderCredential');
  const cacheLookup = subtitlesRoute.indexOf('const cachedSubtitles = await getCachedSubtitles');
  assert.ok(credentialLookup >= 0 && credentialLookup < cacheLookup);
  assert.doesNotMatch(subtitlesRoute, /queryWyzieKey \|\| userWyzieKey \|\| serverWyzieApiKey/);
});

test('subtitle key test probe validates all three providers safely and without caching', async () => {
  assert.equal(isSubtitleKeyProvider('wyzie'), true);
  assert.equal(isSubtitleKeyProvider('subsource'), true);
  assert.equal(isSubtitleKeyProvider('opensubtitles'), true);
  assert.equal(isSubtitleKeyProvider('granite'), false);

  const emptyResult = await testSubtitleProviderKey('subsource', '   ');
  assert.deepEqual(emptyResult, { valid: false, status: 'empty' });

  const calls = [];
  const mockFetch = status => async (url, init) => {
    calls.push({ url, headers: init?.headers || {} });
    return new Response('{}', { status });
  };

  assert.deepEqual(
    await testSubtitleProviderKey('wyzie', 'wyz_123\r\n', mockFetch(200)),
    { valid: true, status: 'valid', httpStatus: 200 }
  );
  assert.match(calls[0].url, /^https:\/\/sub\.wyzie\.io\/search\?id=tt1877830&key=wyz_123$/);

  assert.deepEqual(
    await testSubtitleProviderKey('subsource', 'sub_456\t', mockFetch(401)),
    { valid: false, status: 'invalid', httpStatus: 401 }
  );
  assert.equal(
    calls[1].url,
    'https://api.subsource.net/api/v1/movies/search?searchType=imdb&imdb=tt1877830'
  );
  assert.equal(calls[1].headers['x-api-key'], 'sub_456');

  assert.deepEqual(
    await testSubtitleProviderKey('opensubtitles', 'os_789', mockFetch(429)),
    { valid: false, status: 'rate_limit', httpStatus: 429 }
  );
  assert.equal(
    calls[2].url,
    'https://api.opensubtitles.com/api/v1/subtitles?imdb_id=1877830&type=movie'
  );
  assert.equal(calls[2].headers['Api-Key'], 'os_789');
  assert.equal(calls[2].headers['User-Agent'], 'Framezoo v1.0.0');

  assert.deepEqual(
    await testSubtitleProviderKey('opensubtitles', 'os_789', async () => {
      throw new Error('ECONNREFUSED');
    }),
    { valid: false, status: 'network_error' }
  );

  const testRoute = read('server/routes/addon/subtitles/api/test.post.ts');
  assert.match(testRoute, /private, no-store/);
  assert.match(testRoute, /isSubtitleKeyProvider/);
});
