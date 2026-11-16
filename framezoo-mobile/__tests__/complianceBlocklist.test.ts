import { extractAddonHostname, isAddonDomainBlocked } from '@/services/addons/blocklistMatchers';

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
});
