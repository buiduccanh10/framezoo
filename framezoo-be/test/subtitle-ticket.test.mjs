import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

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

test('subtitles search prioritizes query key over user custom key over server key', () => {
  const subtitlesRoute = read('server/routes/addon/subtitles/subtitles/[type]/[...id].get.ts');

  assert.match(subtitlesRoute, /getUserProviderCredential/);
  assert.match(subtitlesRoute, /queryWyzieKey/);
  assert.match(subtitlesRoute, /userWyzieKey/);
  assert.match(subtitlesRoute, /serverWyzieApiKey/);
  assert.match(
    subtitlesRoute,
    /const wyzieApiKey = queryWyzieKey \|\| userWyzieKey \|\| serverWyzieApiKey/
  );
});
