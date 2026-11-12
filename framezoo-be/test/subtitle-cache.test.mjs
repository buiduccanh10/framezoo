import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  EMPTY_SUBTITLE_CACHE_TTL,
  executeWithInFlightDeduplication,
  getSubtitleCacheKey,
  getSubtitleTtl,
  hashSubtitleCredential,
  MOVIE_SUBTITLE_CACHE_TTL,
  normalizeSubtitleDownloadUrls,
  SERIES_SUBTITLE_CACHE_TTL,
  SUBTITLE_CACHE_PREFIX,
} from '../server/utils/subtitles/cache.ts';

const read = relativePath =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('getSubtitleCacheKey generates stable and sanitized keys', () => {
  assert.equal(
    getSubtitleCacheKey('movie', 'tt1877830'),
    `${SUBTITLE_CACHE_PREFIX}server:movie:tt1877830:all`
  );
  assert.equal(
    getSubtitleCacheKey('series', 'tt0944947:1:1'),
    `${SUBTITLE_CACHE_PREFIX}server:series:tt0944947:1:1:all`
  );
  assert.equal(
    getSubtitleCacheKey('series', 'tmdb:12345:2:10'),
    `${SUBTITLE_CACHE_PREFIX}server:series:tmdb:12345:2:10:all`
  );
  assert.equal(
    getSubtitleCacheKey('movie', 'tt 123 456'),
    `${SUBTITLE_CACHE_PREFIX}server:movie:tt_123_456:all`
  );
  assert.notEqual(
    getSubtitleCacheKey('movie', 'tt1877830', 'user:alice', 'vi,en'),
    getSubtitleCacheKey('movie', 'tt1877830', 'user:bob', 'vi,en')
  );
  assert.notEqual(
    getSubtitleCacheKey('movie', 'tt1877830', 'server:key-a', 'vi,en'),
    getSubtitleCacheKey('movie', 'tt1877830', 'server:key-b', 'vi,en')
  );
  assert.notEqual(
    getSubtitleCacheKey('movie', 'tt1877830', 'user:alice', 'vi'),
    getSubtitleCacheKey('movie', 'tt1877830', 'user:alice', 'en')
  );
});

test('hashSubtitleCredential is stable and does not expose the credential', () => {
  const hash = hashSubtitleCredential('wyzie-secret');

  assert.equal(hash, hashSubtitleCredential('wyzie-secret'));
  assert.equal(hash.length, 64);
  assert.ok(!hash.includes('wyzie-secret'));
});

test('getSubtitleTtl applies 24h for movies, 12h for series, 10m for empty results', () => {
  assert.equal(getSubtitleTtl('movie', 5), MOVIE_SUBTITLE_CACHE_TTL);
  assert.equal(MOVIE_SUBTITLE_CACHE_TTL, 86400);

  assert.equal(getSubtitleTtl('series', 3), SERIES_SUBTITLE_CACHE_TTL);
  assert.equal(SERIES_SUBTITLE_CACHE_TTL, 43200);

  assert.equal(getSubtitleTtl('movie', 0), EMPTY_SUBTITLE_CACHE_TTL);
  assert.equal(getSubtitleTtl('series', 0), EMPTY_SUBTITLE_CACHE_TTL);
  assert.equal(EMPTY_SUBTITLE_CACHE_TTL, 600);
});

test('normalizeSubtitleDownloadUrls ensures origin consistency for subsource items', () => {
  const mockSubtitles = [
    {
      id: 'subsource:vi:12345',
      url: 'https://old-api.framezoo.top/addon/subtitles/download/subsource/sub-abc-123',
      lang: 'vi',
      source: 'subsource',
    },
    {
      id: 'wyzie:vi:67890',
      url: 'https://sub.wyzie.io/download/sub-xyz.srt',
      lang: 'vi',
      source: 'wyzie',
    },
    {
      id: 'opensubs:en:55555',
      url: 'https://dl.opensubtitles.org/sub.srt',
      lang: 'en',
      source: 'opensubs',
    },
  ];

  const currentOrigin = 'https://framezoo.top';
  const normalized = normalizeSubtitleDownloadUrls(mockSubtitles, currentOrigin);

  assert.equal(
    normalized[0].url,
    'https://framezoo.top/addon/subtitles/download/subsource/sub-abc-123'
  );
  assert.equal(normalized[1].url, 'https://sub.wyzie.io/download/sub-xyz.srt');
  assert.equal(normalized[2].url, 'https://dl.opensubtitles.org/sub.srt');
});

test('executeWithInFlightDeduplication coalesces concurrent searches', async () => {
  let callCount = 0;
  const searchMock = async () => {
    callCount += 1;
    await new Promise(resolve => setTimeout(resolve, 50));
    return [{ id: 'test-1', url: 'https://example.com/sub.srt', lang: 'vi' }];
  };

  const key = 'test-concurrent-key';
  const [res1, res2, res3] = await Promise.all([
    executeWithInFlightDeduplication(key, searchMock),
    executeWithInFlightDeduplication(key, searchMock),
    executeWithInFlightDeduplication(key, searchMock),
  ]);

  assert.equal(callCount, 1);
  assert.deepEqual(res1, res2);
  assert.deepEqual(res2, res3);
  assert.equal(res1[0].id, 'test-1');
});

test('subtitles route implements redis cache check and cache headers', () => {
  const routeContent = read('server/routes/addon/subtitles/subtitles/[type]/[...id].get.ts');

  assert.match(routeContent, /getCachedSubtitles/);
  assert.match(routeContent, /setCachedSubtitles/);
  assert.match(routeContent, /executeWithInFlightDeduplication/);
  assert.match(routeContent, /getSubtitleCacheKey/);
  assert.match(routeContent, /getSubtitleTtl/);
  assert.match(routeContent, /normalizeSubtitleDownloadUrls/);
  assert.match(routeContent, /setHeader\(event, 'X-Cache', 'HIT'\)/);
  assert.match(routeContent, /setHeader\(event, 'X-Cache', 'MISS'\)/);
  assert.match(routeContent, /isForceRefresh/);
});
