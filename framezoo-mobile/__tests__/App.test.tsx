import { MockPlayerAdapter } from '../src/adapters/player/MockPlayerAdapter';
import {
  getAddonResourceUrl,
  normalizeAddonManifestUrl,
} from '../src/services/addons/protocol';
import {
  deriveAuthKeys,
  encodePublicKey,
  signChallenge,
} from '../src/services/auth/crypto';

describe('Framezoo mobile app', () => {
  it('runs the mock player contract', async () => {
    const adapter = new MockPlayerAdapter();
    const source = {
      id: 'source-1',
      addonId: 'addon-1',
      addonName: 'Test addon',
      kind: 'hls' as const,
      name: 'Test source',
      title: 'Test source',
      url: 'https://example.test/video.m3u8',
      subtitles: [],
    };

    await adapter.load(source);
    expect(adapter.getSnapshot().status).toBe('paused');
    await adapter.play();
    expect(adapter.getSnapshot().status).toBe('playing');
    await adapter.seek(120);
    expect(adapter.getSnapshot().position).toBe(120);
    await adapter.destroy();
  });

  it('builds generic addon protocol URLs', () => {
    const manifestUrl = normalizeAddonManifestUrl(
      'https://example.test/manifest.json',
    );
    expect(
      getAddonResourceUrl({
        manifestUrl,
        resource: 'stream',
        type: 'movie',
        id: 'tmdb:123',
      }),
    ).toBe('https://example.test/stream/movie/tmdb%3A123.json');
  });

  it('derives stable auth keys and signs a backend challenge', () => {
    const first = deriveAuthKeys('correct horse battery staple 123');
    const second = deriveAuthKeys('correct horse battery staple 123');

    expect(encodePublicKey(first.publicKey)).toBe(
      encodePublicKey(second.publicKey),
    );
    expect(signChallenge(first.secretKey, 'challenge-1')).toBe(
      signChallenge(second.secretKey, 'challenge-1'),
    );
    expect(signChallenge(first.secretKey, 'challenge-1')).not.toBe(
      signChallenge(first.secretKey, 'challenge-2'),
    );
  });

  it('rejects malformed addon manifest URLs', () => {
    expect(() =>
      normalizeAddonManifestUrl('file:///tmp/manifest.json'),
    ).toThrow('Addon manifest must use HTTP or HTTPS');
  });
});
