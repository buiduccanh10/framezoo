import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register, registerHooks } from 'node:module';
import test from 'node:test';

import { resolveServerSubtitleApiKey } from '../server/utils/subtitles/serverKeys.ts';

// Resolve extensionless TypeScript imports and ~/utils/tmdb so plain `node --test` can load Nitro modules.
if (typeof registerHooks === 'function') {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '~/utils/tmdb') {
        return {
          url: 'data:text/javascript,export const tmdb = {};',
          shortCircuit: true,
        };
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
} else {
  const loaderSource = `
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '~/utils/tmdb') {
    return {
      url: 'data:text/javascript,export const tmdb = {};',
      shortCircuit: true,
    };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.[a-z]+$/i.test(specifier) && context.parentURL?.startsWith('file:')) {
    const candidate = new URL(specifier + '.ts', context.parentURL);
    if (fs.existsSync(fileURLToPath(candidate))) {
      return { url: candidate.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
`;
  register(`data:text/javascript,${encodeURIComponent(loaderSource)}`);
}

const { fetchOpenSubtitles } = await import('../server/utils/subtitles/opensubtitles.ts');
const { fetchSubsourceSubtitlesList } = await import('../server/utils/subtitles/subsource.ts');
const { fetchVdrkSubtitles } = await import('../server/utils/subtitles/vdrk.ts');
const { fetchWyzieSubtitles } = await import('../server/utils/subtitles/wyzie.ts');
const { searchAllSubtitles } = await import('../server/utils/subtitles/index.ts');

const read = relativePath =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

const withEnv = async (overrides, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(overrides)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

test('resolveServerSubtitleApiKey falls back to process.env when runtimeConfig is empty or whitespace', () => {
  const env = {
    WYZIE_API_KEY: '  wyzie_env_key  ',
    SUBSOURCE_API_KEY: 'subsource_env_key',
    OPENSUBTITLES_API_KEY: 'opensubs_env_key',
  };

  // Empty/whitespace strings in runtimeConfig must NOT block process.env fallback
  assert.equal(
    resolveServerSubtitleApiKey('wyzie', undefined, env, { wyzieApiKey: '' }),
    'wyzie_env_key'
  );
  assert.equal(
    resolveServerSubtitleApiKey('subsource', undefined, env, { subsourceApiKey: '   ' }),
    'subsource_env_key'
  );
  assert.equal(
    resolveServerSubtitleApiKey('opensubtitles', undefined, env, { opensubtitlesApiKey: '' }),
    'opensubs_env_key'
  );

  // Explicit non-empty runtimeConfig (e.g. NITRO_* override) wins and trims
  assert.equal(
    resolveServerSubtitleApiKey('wyzie', undefined, env, { wyzieApiKey: ' nitro_wyzie ' }),
    'nitro_wyzie'
  );

  // Returns undefined when neither is configured
  assert.equal(
    resolveServerSubtitleApiKey('opensubtitles', undefined, { OPENSUBTITLES_API_KEY: '  ' }, {
      opensubtitlesApiKey: '',
    }),
    undefined
  );
});

test('fetchWyzieSubtitles uses env key fallback, makes single request per ID, and stops on 429', async () => {
  await withEnv({ WYZIE_API_KEY: 'env_wyzie_key' }, async () => {
    const requestedUrls = [];
    const mockFetch = async url => {
      requestedUrls.push(url);
      return new Response(
        JSON.stringify([
          {
            id: 101,
            url: 'https://sub.wyzie.io/sub/101.srt',
            language: 'vi',
            source: 'charlie',
            fileName: 'Hannibal.S02E01.vi.srt',
          },
        ]),
        { status: 200 }
      );
    };

    const subs = await fetchWyzieSubtitles(
      { type: 'series', id: 'tt2243973:2:1', imdbId: 'tt2243973', tmdbId: 40008, season: 2, episode: 1 },
      undefined,
      ['vi', 'en'],
      { fetchFn: mockFetch }
    );

    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /id=tt2243973/);
    assert.match(requestedUrls[0], /key=env_wyzie_key/);
    assert.doesNotMatch(requestedUrls[0], /language=/);
    assert.equal(subs.length, 1);
    assert.equal(subs[0].lang, 'vi');

    // User-configured key overrides env key
    const userUrls = [];
    await fetchWyzieSubtitles(
      { type: 'movie', id: 'tt1877830', imdbId: 'tt1877830' },
      'user_wyzie_key',
      [],
      {
        fetchFn: async url => {
          userUrls.push(url);
          return new Response('[]', { status: 200 });
        },
      }
    );
    assert.match(userUrls[0], /key=user_wyzie_key/);

    // 429 stops immediately without trying tmdbId fallback and reports error
    const rateLimitUrls = [];
    let errored = false;
    const rateLimitedSubs = await fetchWyzieSubtitles(
      { type: 'series', id: 'tt2243973:2:1', imdbId: 'tt2243973', tmdbId: 40008, season: 2, episode: 1 },
      undefined,
      [],
      {
        onError: () => {
          errored = true;
        },
        fetchFn: async url => {
          rateLimitUrls.push(url);
          return new Response('{"code":429}', { status: 429 });
        },
      }
    );
    assert.equal(rateLimitUrls.length, 1);
    assert.equal(errored, true);
    assert.deepEqual(rateLimitedSubs, []);
  });
});

test('fetchOpenSubtitles uses env key fallback, supports user override, and reports 5xx errors', async () => {
  await withEnv({ OPENSUBTITLES_API_KEY: 'env_os_key' }, async () => {
    const calls = [];
    const subs = await fetchOpenSubtitles(
      { type: 'series', id: 'tt2243973:2:1', imdbId: 'tt2243973', season: 2, episode: 1 },
      undefined,
      'https://framezoo.top/addon/subtitles/download/opensubtitles',
      {
        fetchFn: async (url, init) => {
          calls.push({ url, headers: init?.headers || {} });
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: '1',
                  attributes: {
                    language: 'en',
                    release: 'Hannibal.S02E01.WEB-DL',
                    hearing_impaired: false,
                    format: 'srt',
                    files: [{ file_id: 55501, file_name: 'hannibal.srt' }],
                  },
                },
              ],
            }),
            { status: 200 }
          );
        },
      }
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers['Api-Key'], 'env_os_key');
    assert.equal(subs.length, 1);
    assert.equal(subs[0].source, 'opensubs');
    assert.equal(subs[0].url, 'https://framezoo.top/addon/subtitles/download/opensubtitles/55501');

    // User key overrides env key
    await fetchOpenSubtitles(
      { type: 'movie', id: 'tmdb:123', tmdbId: 123 },
      'user_os_key',
      undefined,
      {
        fetchFn: async (url, init) => {
          calls.push({ url, headers: init?.headers || {} });
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        },
      }
    );
    assert.match(calls[1].url, /tmdb_id=123/);
    assert.equal(calls[1].headers['Api-Key'], 'user_os_key');

    let errored = false;
    await fetchOpenSubtitles(
      { type: 'movie', id: 'tt1877830', imdbId: 'tt1877830' },
      undefined,
      undefined,
      {
        onError: () => {
          errored = true;
        },
        fetchFn: async () => new Response('error', { status: 502 }),
      }
    );
    assert.equal(errored, true);
  });
});

test('searchAllSubtitles aggregates all 4 providers from env keys and reports partial failures', async () => {
  await withEnv(
    {
      WYZIE_API_KEY: 'env_wyzie',
      SUBSOURCE_API_KEY: 'env_subsource',
      OPENSUBTITLES_API_KEY: 'env_opensubs',
    },
    async () => {
      const mockFetch = async url => {
        if (url.startsWith('https://api.subsource.net/api/v1/movies/search')) {
          return new Response(JSON.stringify([{ id: 42, link: '/subtitles/hannibal' }]), { status: 200 });
        }
        if (url.startsWith('https://api.subsource.net/api/v1/subtitles')) {
          return new Response(
            JSON.stringify([
              { id: 921188, language: 'english', releaseInfo: 'Hannibal.S02E01.WEB-DL' },
            ]),
            { status: 200 }
          );
        }
        if (url.startsWith('https://api.subsource.net/v1/subtitles/')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.startsWith('https://sub.wyzie.io/search')) {
          return new Response(
            JSON.stringify([{ id: 7, url: 'https://sub.wyzie.io/7.srt', language: 'vi', source: 'charlie' }]),
            { status: 200 }
          );
        }
        if (url.startsWith('https://api.opensubtitles.com/api/v1/subtitles')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: '9',
                  attributes: {
                    language: 'en',
                    release: 'OpenSubs.Release',
                    files: [{ file_id: 999 }],
                  },
                },
              ],
            }),
            { status: 200 }
          );
        }
        if (url.startsWith('https://sub.vdrk.site/')) {
          return new Response(
            JSON.stringify([{ label: 'English', file: 'https://cache.vdrk.site/en.vtt' }]),
            { status: 200 }
          );
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const errors = [];
      const all = await searchAllSubtitles(
        { type: 'series', id: 'tt2243973:2:1', imdbId: 'tt2243973', tmdbId: 40008, season: 2, episode: 1 },
        {
          fetchFn: mockFetch,
          onProviderError: p => errors.push(p),
        }
      );

      assert.deepEqual(errors, []);
      assert.deepEqual(
        all.map(s => s.source),
        ['subsource', 'wyzie charlie', 'opensubs', 'granite']
      );

      // Partial failure triggers onProviderError while preserving healthy results
      const partialErrors = [];
      const partial = await searchAllSubtitles(
        { type: 'movie', id: 'tt1877830', imdbId: 'tt1877830', tmdbId: 414906 },
        {
          onProviderError: p => partialErrors.push(p),
          fetchFn: async url => {
            if (url.startsWith('https://sub.vdrk.site/')) {
              return new Response('unavailable', { status: 503 });
            }
            return mockFetch(url);
          },
        }
      );
      assert.deepEqual(partialErrors, ['granite']);
      assert.equal(partial.length, 3);
    }
  );

  // Verify subsource & vdrk error callbacks directly
  let vdrkErrored = false;
  await fetchVdrkSubtitles(
    { type: 'movie', id: 'tmdb:1', tmdbId: 1 },
    {
      onError: () => {
        vdrkErrored = true;
      },
      fetchFn: async () => new Response('err', { status: 500 }),
    }
  );
  assert.equal(vdrkErrored, true);

  let subsourceErrored = false;
  await withEnv({ SUBSOURCE_API_KEY: 'env_sub' }, async () => {
    await fetchSubsourceSubtitlesList(
      { type: 'movie', id: 'tt1877830', imdbId: 'tt1877830' },
      undefined,
      undefined,
      {
        onError: () => {
          subsourceErrored = true;
        },
        fetchFn: async () => new Response('rate limit', { status: 429 }),
      }
    );
  });
  assert.equal(subsourceErrored, true);
});

test('nitro.config.ts and subtitle routes resolve env keys dynamically without build-time baking', () => {
  const nitroConfig = read('nitro.config.ts');
  assert.match(nitroConfig, /wyzieApiKey:\s*''/);
  assert.match(nitroConfig, /subsourceApiKey:\s*''/);
  assert.match(nitroConfig, /opensubtitlesApiKey:\s*''/);
  assert.doesNotMatch(nitroConfig, /wyzieApiKey:\s*process\.env\.WYZIE_API_KEY/);
  assert.doesNotMatch(nitroConfig, /subsourceApiKey:\s*process\.env\.SUBSOURCE_API_KEY/);
  assert.doesNotMatch(nitroConfig, /opensubtitlesApiKey:\s*process\.env\.OPENSUBTITLES_API_KEY/);

  const route = read('server/routes/addon/subtitles/subtitles/[type]/[...id].get.ts');
  assert.match(route, /resolveServerSubtitleApiKey\('wyzie', event\)/);
  assert.match(route, /resolveServerSubtitleApiKey\('subsource', event\)/);
  assert.match(route, /resolveServerSubtitleApiKey\('opensubtitles', event\)/);
  assert.match(route, /hadProviderFailure/);
  assert.match(route, /EMPTY_SUBTITLE_CACHE_TTL/);

  const subsourceDl = read('server/routes/addon/subtitles/download/subsource/[id].get.ts');
  assert.match(subsourceDl, /resolveServerSubtitleApiKey\('subsource', event\)/);

  const opensubsDl = read('server/routes/addon/subtitles/download/opensubtitles/[id].get.ts');
  assert.match(opensubsDl, /resolveServerSubtitleApiKey\('opensubtitles', event\)/);
});
