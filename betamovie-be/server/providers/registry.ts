import type { Stream, StreamLookupContext } from './types';
import { getVixsrcStreams } from './vixsrc';
import { getVidlinkStreams } from './vidlink';
import { getVidSrcStreams } from './vidsrc';
import { getVidsrcRuStreams } from './vidsrc-ru';
import { getVidsrcWtfStreams } from './vidsrcwtf';
import { getVidrockStreams } from './vidrock';
import { getKKPhimStreams } from './kkphim';
import { get111MoviesStreams } from './111movies';
import { getVidkingStreams } from './vidking';

export interface StreamProvider {
  name: string;
  type: 'direct' | 'torrent';
  getStreams(
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    season?: number | null,
    episode?: number | null,
    storage?: ReturnType<typeof useStorage>,
    context?: StreamLookupContext
  ): Promise<Stream[]>;
}

/**
 * Vixsrc provider implementation
 */
const vixsrcProvider: StreamProvider = {
  name: 'vixsrc',
  type: 'direct',
  getStreams: getVixsrcStreams,
};

const vidlinkProvider: StreamProvider = {
  name: 'vidlink',
  type: 'direct',
  getStreams: getVidlinkStreams,
};

const vidsrcProvider: StreamProvider = {
  name: 'vidsrc',
  type: 'direct',
  getStreams: getVidSrcStreams,
};

const vidsrcRuProvider: StreamProvider = {
  name: 'vidsrc-ru',
  type: 'direct',
  getStreams: getVidsrcRuStreams,
};

const vidsrcWtfProvider: StreamProvider = {
  name: 'vidsrcwtf',
  type: 'direct',
  getStreams: getVidsrcWtfStreams,
};

const vidrockProvider: StreamProvider = {
  name: 'vidrock',
  type: 'direct',
  getStreams: getVidrockStreams,
};

const kkphimProvider: StreamProvider = {
  name: 'kkphim',
  type: 'direct',
  getStreams: getKKPhimStreams,
};

const movies111Provider: StreamProvider = {
  name: '111movies',
  type: 'direct',
  getStreams: get111MoviesStreams,
};

const vidkingProvider: StreamProvider = {
  name: 'vidking',
  type: 'direct',
  getStreams: getVidkingStreams,
};

/**
 * Registry of all available stream providers
 */
const providers: Map<string, StreamProvider> = new Map([
  ['111movies', movies111Provider],
  ['vidking', vidkingProvider],
  ['vidlink', vidlinkProvider],
  ['vixsrc', vixsrcProvider],
  ['vidsrcwtf', vidsrcWtfProvider],
  ['vidrock', vidrockProvider],
  ['vidsrc', vidsrcProvider],
  ['vidsrc-ru', vidsrcRuProvider],
  ['kkphim', kkphimProvider],
  // Add more providers here in the future
  // ["torrent-provider", torrentProvider],
]);

/**
 * Get a provider by name
 */
export function getProvider(name: string): StreamProvider | undefined {
  return providers.get(name);
}

/**
 * Get all available providers
 */
export function getAllProviders(): StreamProvider[] {
  return Array.from(providers.values());
}

/**
 * Get all provider names
 */
export function getProviderNames(): string[] {
  return Array.from(providers.keys());
}

/**
 * Check if a provider exists
 */
export function hasProvider(name: string): boolean {
  return providers.has(name);
}

/**
 * Register a new provider (for future extensibility)
 */
export function registerProvider(provider: StreamProvider): void {
  providers.set(provider.name, provider);
  console.log(`[ProviderRegistry] Registered provider: ${provider.name}`);
}

/**
 * Unregister a provider (for future extensibility)
 */
export function unregisterProvider(name: string): boolean {
  return providers.delete(name);
}
