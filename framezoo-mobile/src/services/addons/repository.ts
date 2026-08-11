import type {
  AddonCatalogItem,
  AddonMeta,
  AddonSubtitle,
  AddonProtocolRequest,
  AddonStream,
  AddonStreamLoadError,
  InstalledAddon,
  StremioManifest,
} from '@/types';

import {
  addonRuntime,
  hasAddonResource,
  normalizeAddonManifestUrl,
} from './protocol';
import { mobileStorage } from '../storage/storage';

const STORAGE_KEY = '@framezoo/mobile/addons';

interface StreamResponse {
  streams?: Array<{
    name?: string;
    title?: string;
    description?: string;
    url?: string;
    infoHash?: string;
    fileIdx?: number;
    behaviorHints?: {
      filename?: string;
      videoSize?: number;
      bingeGroup?: string;
      proxyHeaders?: { request?: Record<string, string> };
    };
    subtitles?: Array<{ id?: string; url?: string; lang?: string; language?: string; label?: string }>;
  }>;
}

type RawStream = NonNullable<StreamResponse['streams']>[number];

interface CatalogResponse {
  metas?: Array<{
    id?: string;
    type?: string;
    name?: string;
    poster?: string;
    description?: string;
    releaseInfo?: string;
  }>;
}

interface MetaResponse {
  meta?: AddonMeta;
}

interface SubtitleResponse {
  subtitles?: Array<{
    id?: string;
    url?: string;
    lang?: string;
    label?: string;
  }>;
}

function normalizeManifest(manifestUrl: string, manifest: StremioManifest): InstalledAddon {
  return {
    manifestUrl,
    baseUrl: new URL('.', manifestUrl).toString(),
    manifest,
    enabled: true,
    addedAt: Date.now(),
  };
}

function streamKind(value: RawStream) {
  const url = value.url?.toLowerCase() ?? '';
  if (value.infoHash || url.startsWith('magnet:')) return 'torrent' as const;
  if (url.includes('.m3u8')) return 'hls' as const;
  if (url.includes('.mpd')) return 'dash' as const;
  return 'file' as const;
}

function normalizeStreams(addon: InstalledAddon, response: StreamResponse): AddonStream[] {
  return (response.streams ?? [])
    .filter((stream) => Boolean(stream.url || stream.infoHash))
    .map((stream, index) => ({
      id: `${addon.manifest.id}:${index}:${stream.url ?? stream.infoHash}`,
      addonId: addon.manifest.id,
      addonName: addon.manifest.name,
      kind: streamKind(stream),
      name: stream.name ?? stream.title ?? 'Addon stream',
      title: stream.title ?? stream.name ?? '',
      description: stream.description,
      url: stream.url ?? `magnet:?xt=urn:btih:${stream.infoHash}`,
      infoHash: stream.infoHash,
      fileIdx: stream.fileIdx,
      fileName: stream.behaviorHints?.filename,
      videoSize: stream.behaviorHints?.videoSize,
      subtitles: (stream.subtitles ?? [])
        .filter((subtitle) => Boolean(subtitle.url))
        .map((subtitle, subtitleIndex) => ({
          id: subtitle.id ?? `${index}:${subtitleIndex}`,
          language: subtitle.lang ?? subtitle.language ?? 'und',
          label: subtitle.label,
          url: subtitle.url as string,
        })),
      headers: stream.behaviorHints?.proxyHeaders?.request,
    }));
}

export const addonRepository = {
  async list(): Promise<InstalledAddon[]> {
    return (await mobileStorage.getJson<InstalledAddon[]>(STORAGE_KEY)) ?? [];
  },
  async save(addons: InstalledAddon[]) {
    await mobileStorage.setJson(STORAGE_KEY, addons);
    return addons;
  },
  async install(input: string) {
    const manifestUrl = normalizeAddonManifestUrl(input);
    const manifest = await addonRuntime.loadManifest(manifestUrl);
    const addons = await this.list();
    const next = [
      ...addons.filter((addon) => addon.manifest.id !== manifest.id),
      normalizeManifest(manifestUrl, manifest),
    ];
    await this.save(next);
    return next[next.length - 1];
  },
  async remove(id: string) {
    return this.save((await this.list()).filter((addon) => addon.manifest.id !== id));
  },
  async setEnabled(id: string, enabled: boolean) {
    return this.save(
      (await this.list()).map((addon) =>
        addon.manifest.id === id ? { ...addon, enabled } : addon,
      ),
    );
  },
  async request<T>(request: AddonProtocolRequest) {
    return addonRuntime.request<T>(request);
  },
  async loadCatalog(
    type: string,
    catalogId: string,
  ): Promise<{ items: AddonCatalogItem[]; failures: AddonStreamLoadError[] }> {
    const addons = (await this.list()).filter(
      (addon) => addon.enabled && hasAddonResource(addon.manifest, 'catalog'),
    );
    const results = await Promise.allSettled(
      addons.map(async (addon) => {
        const response = await this.request<CatalogResponse>({
          manifestUrl: addon.manifestUrl,
          resource: 'catalog',
          type,
          catalogId,
        });
        return (response.body.metas ?? [])
          .filter((item) => Boolean(item.id && item.name))
          .map((item) => ({
            id: item.id as string,
            type: item.type ?? type,
            name: item.name as string,
            poster: item.poster,
            description: item.description,
            year: item.releaseInfo ? Number(item.releaseInfo.slice(0, 4)) : undefined,
          }));
      }),
    );
    return {
      items: results.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      ),
      failures: failuresFor(addons, results),
    };
  },
  async loadMeta(type: string, id: string): Promise<AddonMeta[]> {
    const addons = (await this.list()).filter(
      (addon) => addon.enabled && hasAddonResource(addon.manifest, 'meta'),
    );
    const results = await Promise.allSettled(
      addons.map(async (addon) => {
        const response = await this.request<MetaResponse>({
          manifestUrl: addon.manifestUrl,
          resource: 'meta',
          type,
          id,
        });
        return response.body.meta ? [response.body.meta] : [];
      }),
    );
    return results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
  },
  async loadSubtitles(type: string, id: string): Promise<AddonSubtitle[]> {
    const addons = (await this.list()).filter(
      (addon) => addon.enabled && hasAddonResource(addon.manifest, 'subtitles'),
    );
    const results = await Promise.allSettled(
      addons.map(async (addon) => {
        const response = await this.request<SubtitleResponse>({
          manifestUrl: addon.manifestUrl,
          resource: 'subtitles',
          type,
          id,
        });
        return (response.body.subtitles ?? [])
          .filter((subtitle) => Boolean(subtitle.id && subtitle.url))
          .map((subtitle) => ({
            id: subtitle.id as string,
            url: subtitle.url as string,
            lang: subtitle.lang,
            label: subtitle.label,
            addonId: addon.manifest.id,
            addonName: addon.manifest.name,
          }));
      }),
    );
    return results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
  },
  async loadStreams(
    media: { type: 'movie' | 'series'; id: string; season?: number; episode?: number },
  ) {
    const addons = (await this.list()).filter(
      (addon) => addon.enabled && hasAddonResource(addon.manifest, 'stream'),
    );
    const id =
      media.type === 'series' && media.season !== undefined && media.episode !== undefined
        ? `${media.id}:${media.season}:${media.episode}`
        : media.id;
    const results = await Promise.allSettled(
      addons.map((addon) =>
        this.request<StreamResponse>({
          manifestUrl: addon.manifestUrl,
          resource: 'stream',
          type: media.type,
          id,
      }).then((response) => normalizeStreams(addon, response.body)),
      ),
    );
    return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  },
};

function failuresFor<T>(
  addons: InstalledAddon[],
  results: PromiseSettledResult<T>[],
) {
  return results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return [];
    const addon = addons[index];
    return [{
      addonId: addon.manifest.id,
      addonName: addon.manifest.name,
      url: addon.manifestUrl,
      message: result.reason instanceof Error ? result.reason.message : 'Addon request failed',
    }];
  });
}
