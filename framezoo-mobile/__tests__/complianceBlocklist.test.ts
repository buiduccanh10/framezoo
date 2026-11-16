import {
  extractAddonHostname,
  isAddonDomainBlocked,
  isInfohashBlocked,
  isMediaIdBlocked,
  isSubtitleIdBlocked,
} from '@/services/addons/blocklistMatchers';

describe('mobile compliance addon blocklist', () => {
  it('matches blocked root domains and subdomains without false positives', () => {
    expect(extractAddonHostname('HTTPS://CDN.BadAddon.example:8443/manifest.json')).toBe(
      'cdn.badaddon.example',
    );
    expect(
      isAddonDomainBlocked('https://edge.badaddon.example/manifest.json', ['badaddon.example']),
    ).toBe(true);
    expect(
      isAddonDomainBlocked('https://good-badaddon.example/manifest.json', ['badaddon.example']),
    ).toBe(false);
  });

  it('matches tmdb, imdb, infohashes, and subtitle ids across forms', () => {
    expect(
      isMediaIdBlocked('550', 'movie', { tmdbIds: ['movie:550'], imdbIds: [] }),
    ).toBe(true);
    expect(
      isMediaIdBlocked('tmdb:1399', 'series', { tmdbIds: ['tv:1399'], imdbIds: [] }),
    ).toBe(true);
    expect(
      isMediaIdBlocked('tt0137523:1:2', 'series', { tmdbIds: [], imdbIds: ['tt0137523'] }),
    ).toBe(true);
    expect(
      isMediaIdBlocked('999', 'movie', { tmdbIds: ['tv:999'], imdbIds: [] }),
    ).toBe(false);

    expect(
      isInfohashBlocked(
        null,
        'magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12',
        ['abcdef1234567890abcdef1234567890abcdef12'],
      ),
    ).toBe(true);

    expect(isSubtitleIdBlocked('subsource:99123:vi', ['subsource:99123'])).toBe(true);
    expect(isSubtitleIdBlocked('opensubs:555', ['opensubs:555:en'])).toBe(true);
    expect(isSubtitleIdBlocked('wyzie:111:en', ['subsource:111'])).toBe(false);
  });
});
