import type { Stream, StreamLookupContext } from './types';
import { getVixsrcStreams } from './vixsrc';
import { getVidlinkStreams } from './vidlink';
import { getVidSrcToStreams } from './vidsrc-to';
import { getKKPhimStreams } from './kkphim';
import { get111MoviesStreams } from './111movies';
import { getVidkingStreams } from './vidking';
import { getVideasyStreams } from './videasy';

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

const vidsrcToProvider: StreamProvider = {
  name: 'vidsrcto',
  getStreams: getVidSrcToStreams,
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

const videasyProvider: StreamProvider = {
  name: 'videasy',
  type: 'direct',
  getStreams: getVideasyStreams,
};

/**
 * Registry of all available stream providers
 */
const providers: Map<string, StreamProvider> = new Map([
  ['111movies', movies111Provider],
  ['videasy', videasyProvider],
  ['vidking', vidkingProvider],
  ['vidlink', vidlinkProvider],
  ['vixsrc', vixsrcProvider],
  ['vidsrcto', vidsrcToProvider],
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
