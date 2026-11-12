import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relativePath =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('desktop download route aggregates total downloads alongside manifest options', () => {
  const downloadRoute = read('server/routes/download.get.ts');
  const desktopUtils = read('server/utils/desktopRelease.ts');

  assert.match(downloadRoute, /fetchDesktopTotalDownloads/);
  assert.match(downloadRoute, /totalDownloads: totalDownloads \?\? null/);
  assert.match(desktopUtils, /fetchDesktopTotalDownloads/);
  assert.match(desktopUtils, /DOWNLOAD_STATS_CACHE_TTL_MS/);
});
