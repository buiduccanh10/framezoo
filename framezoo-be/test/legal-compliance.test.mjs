import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  COMPLIANCE_SLA_HOURS,
  computeFeedbackSlaDueAt,
  normalizeFeedbackCategory,
} from '../server/utils/legalConstants.ts';
import {
  parseOmdbInteger,
  parseOmdbList,
  parseOmdbNumber,
  parseOmdbRottenTomatoesScore,
  resolveOmdbApiKey,
} from '../server/utils/omdb.ts';
import {
  filterBlockedAddons,
  isDomainBlocked,
  isImdbBlocked,
  isSubtitleIdBlocked,
  isTmdbBlocked,
  normalizeTakedownPattern,
} from '../server/utils/takedownMatchers.ts';

const read = relativePath =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

const exists = relativePath =>
  fs.existsSync(new URL(`../${relativePath}`, import.meta.url));

test('takedown matchers block exact hosts, subdomains, media ids, and addons', () => {
  assert.equal(
    normalizeTakedownPattern('addon_domain', 'HTTPS://BadAddon.Example.com:8443/manifest.json'),
    'badaddon.example.com'
  );
  assert.equal(isDomainBlocked('https://cdn.badaddon.example.com/addon.json', ['badaddon.example.com']), true);
  assert.equal(isDomainBlocked('https://good-badaddon.example.com/addon.json', ['badaddon.example.com']), false);

  assert.equal(isTmdbBlocked('550', ['movie:550'], 'movie'), true);
  assert.equal(isTmdbBlocked(550, ['550'], 'tv'), true);
  assert.equal(isTmdbBlocked('551', ['movie:550'], 'movie'), false);

  assert.equal(isImdbBlocked('tt0137523:1:2', ['tt0137523']), true);
  assert.equal(isImdbBlocked('tt0137524', ['tt0137523']), false);

  assert.equal(isSubtitleIdBlocked('subsource:99123:vi', ['99123']), true);
  assert.equal(isSubtitleIdBlocked('subsource:99123:vi', ['subsource:99123']), true);
  assert.equal(isSubtitleIdBlocked('wyzie:111:en', ['subsource:99123']), false);

  const { addons, removedCount } = filterBlockedAddons(
    [
      { name: 'Ok', manifestUrl: 'https://clean-addon.org/manifest.json' },
      { name: 'Blocked', url: 'https://sub.pirate-addon.net/manifest.json' },
      'https://pirate-addon.net/manifest.json',
    ],
    ['pirate-addon.net']
  );
  assert.equal(removedCount, 2);
  assert.equal(addons.length, 1);
  assert.equal(addons[0].name, 'Ok');
});

test('legal feedback categories compute 24h SLA only for copyright and privacy reports', () => {
  const now = new Date('2026-11-16T00:00:00.000Z');
  assert.equal(normalizeFeedbackCategory('COPYRIGHT'), 'copyright');
  assert.equal(normalizeFeedbackCategory('invalid-cat'), 'bug');

  const dmcaDue = computeFeedbackSlaDueAt('copyright', now);
  assert.ok(dmcaDue);
  assert.equal(dmcaDue.getTime() - now.getTime(), COMPLIANCE_SLA_HOURS * 3600 * 1000);
  assert.ok(computeFeedbackSlaDueAt('privacy', now));
  assert.equal(computeFeedbackSlaDueAt('bug', now), null);
});

test('OMDb helpers parse ratings safely and fail closed when OMDB_API_KEY is missing', () => {
  const previous = process.env.OMDB_API_KEY;
  delete process.env.OMDB_API_KEY;
  try {
    assert.throws(() => resolveOmdbApiKey(), /OMDB_API_KEY/);
  } finally {
    if (previous !== undefined) process.env.OMDB_API_KEY = previous;
  }

  assert.equal(parseOmdbNumber('8.7'), 8.7);
  assert.equal(parseOmdbNumber('N/A'), null);
  assert.equal(parseOmdbInteger('1,234,567'), 1234567);
  assert.deepEqual(parseOmdbList('Drama, Crime, N/A'), ['Drama', 'Crime']);
  assert.equal(
    parseOmdbRottenTomatoesScore([
      { Source: 'Internet Movie Database', Value: '8.7/10' },
      { Source: 'Rotten Tomatoes', Value: '94%' },
    ]),
    94
  );
  assert.equal(parseOmdbRottenTomatoesScore([]), null);
});

test('legacy addon proxy, HTML scrapers, and content metrics are removed', () => {
  assert.equal(exists('server/routes/addon/proxy.get.ts'), false);
  assert.equal(exists('server/utils/aws-waf.ts'), false);

  const letterboxd = read('server/routes/letterboxd/index.get.ts');
  assert.doesNotMatch(letterboxd, /letterboxd\.com/);
  assert.doesNotMatch(letterboxd, /cheerio/);

  const opensubs = read('server/utils/subtitles/opensubtitles.ts');
  assert.match(opensubs, /api\.opensubtitles\.com\/api\/v1/);
  assert.doesNotMatch(opensubs, /VLSub/);
  assert.doesNotMatch(opensubs, /rest\.opensubtitles\.org/);

  const subsourceDownload = read('server/routes/addon/subtitles/download/subsource/[id].get.ts');
  assert.match(subsourceDownload, /private, no-store/);

  const metrics = read('server/utils/metrics.ts');
  assert.doesNotMatch(metrics, /tmdb_full_id/);
  assert.doesNotMatch(metrics, /title:\s*lastItem\.title/);

  const registerRoute = read('server/routes/auth/register/complete.ts');
  assert.match(registerRoute, /legalConsentSchema/);
  assert.match(registerRoute, /ageConfirmed/);

  const attachmentDownload = read('server/api/feedback/[id]/attachments/[key].get.ts');
  assert.match(attachmentDownload, /attachment\.kind === 'document' \? 'attachment' : 'inline'/);

  const exportRoute = read('server/routes/users/[id]/export.get.ts');
  assert.match(exportRoute, /framezoo-personal-data-/);
  assert.match(exportRoute, /configuredCredentialProviders/);
});
