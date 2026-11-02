import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relativePath =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('subtitles manifest includes logo url and configurable behaviorHints', () => {
  const manifestRoute = read('server/routes/addon/subtitles/manifest.json.get.ts');

  assert.match(manifestRoute, /community\.framezoo\.subtitles/);
  assert.match(manifestRoute, /configurable: true/);
  assert.match(manifestRoute, /configurationUrl: `\$\{frontendOrigin\}\/addon\/subtitles\/configure`/);
  assert.match(manifestRoute, /logo: 'https:\/\/framezoo\.top\/favicon-192\.png'/);
});

test('subtitles configure route redirects to frontend configure page', () => {
  const configureRoute = read('server/routes/addon/subtitles/configure.get.ts');

  assert.match(configureRoute, /resolveFrontendOrigin/);
  assert.match(configureRoute, /sendRedirect/);
  assert.match(configureRoute, /\/addon\/subtitles\/configure/);
});
