import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';

const serverRoot = new URL('../server/', import.meta.url);

if (typeof registerHooks === 'function') {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '~/utils/tmdb') {
        return {
          url: 'data:text/javascript,export const tmdb = {};',
          shortCircuit: true,
        };
      }
      if (specifier.startsWith('~/')) {
        const candidate = new URL(`${specifier.slice(2)}.ts`, serverRoot);
        if (fs.existsSync(candidate)) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
      if (
        (specifier.startsWith('./') || specifier.startsWith('../')) &&
        !/\.[a-z]+$/i.test(specifier) &&
        context.parentURL?.startsWith('file:')
      ) {
        const candidate = new URL(`${specifier}.ts`, context.parentURL);
        if (fs.existsSync(candidate)) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
      return nextResolve(specifier, context);
    },
  });
}

const { executeAiSearch, mapGenreSlugsToTmdbIds } = await import('../server/utils/aiSearch.ts');
const { getRateLimitConfig } = await import('../server/middleware/a-rate-limit.ts');

test('mapGenreSlugsToTmdbIds maps movie and TV genre IDs accurately', () => {
  assert.deepEqual(mapGenreSlugsToTmdbIds(['thriller', 'drama', 'science-fiction'], 'movie'), [
    53, 18, 878,
  ]);
  assert.deepEqual(mapGenreSlugsToTmdbIds(['science-fiction', 'fantasy', 'action'], 'tv'), [
    10765, 10759,
  ]);
});

test('executeAiSearch prioritizes candidateTitles, discovers, and deduplicates', async () => {
  const tmdbCalls = [];
  const mockTmdb = {
    async fetch(path, query) {
      tmdbCalls.push({ path, query });
      if (path === '/search/movie') {
        return {
          results: [
            { id: 77, title: 'Memento', poster_path: '/m.jpg', release_date: '2000-10-11' },
            { id: 999, media_type: 'person', name: 'Ignored Person' },
          ],
        };
      }
      if (path === '/discover/movie') {
        return {
          results: [
            { id: 77, title: 'Memento Duplicate', poster_path: '/m.jpg', release_date: '2000-10-11' },
            { id: 496243, title: 'Parasite', poster_path: '/p.jpg', release_date: '2019-05-30' },
          ],
        };
      }
      return { results: [] };
    },
  };

  const mockFetch = async () =>
    new Response(
      JSON.stringify({
        ok: true,
        intent: {
          intent: 'hybrid',
          mediaType: 'movie',
          candidateTitles: ['Memento'],
          keywords: ['amnesia', 'plot twist'],
          genres: ['thriller', 'mystery'],
          originCountries: ['US'],
          originalLanguages: ['en'],
          yearFrom: null,
          yearTo: null,
          minRating: null,
          sortBy: 'popularity',
          summary: 'Finding mind-bending thrillers like Memento',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  const out = await executeAiSearch({
    query: 'movies about amnesia and revenge',
    language: 'en-US',
    mediaType: 'all',
    gatewayUrl: 'https://example.workers.dev',
    gatewaySecret: 'secret',
    tmdbClient: mockTmdb,
    fetchFn: mockFetch,
  });

  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].id, 77);
  assert.equal(out.results[1].id, 496243);
  assert.equal(
    tmdbCalls.some(c => c.path === '/discover/movie' && c.query.with_genres === '53,9648'),
    true,
  );
});

test('executeAiSearch falls back to keyword search when candidate and discover yield few hits', async () => {
  const tmdbCalls = [];
  const mockTmdb = {
    async fetch(path, query) {
      tmdbCalls.push({ path, query });
      if (path === '/search/multi' && query.query === 'time loop') {
        return {
          results: [
            {
              id: 137,
              media_type: 'movie',
              title: 'Groundhog Day',
              release_date: '1993-02-11',
            },
          ],
        };
      }
      return { results: [] };
    },
  };

  const mockFetch = async () =>
    new Response(
      JSON.stringify({
        ok: true,
        intent: {
          intent: 'discover',
          mediaType: 'all',
          candidateTitles: [],
          keywords: ['time loop'],
          genres: [],
          originCountries: [],
          originalLanguages: [],
          yearFrom: null,
          yearTo: null,
          minRating: null,
          sortBy: 'popularity',
          summary: 'Time loop movies and series',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  const out = await executeAiSearch({
    query: 'time loop movies',
    language: 'en-US',
    mediaType: 'all',
    gatewayUrl: 'https://example.workers.dev',
    gatewaySecret: 'secret',
    tmdbClient: mockTmdb,
    fetchFn: mockFetch,
  });

  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].title, 'Groundhog Day');
  assert.equal(
    tmdbCalls.some(c => c.path === '/search/multi' && c.query.query === 'time loop'),
    true,
  );
});

test('getRateLimitConfig returns dedicated ai-search rate limit config', () => {
  const cfg = getRateLimitConfig('/api/ai/search');
  assert.equal(cfg.scope, 'ai-search');
  assert.equal(cfg.windowMs, 60_000);
  assert.equal(cfg.maxRequests, 15);
});
