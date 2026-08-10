export type AddonProtocolResource =
  | 'catalog'
  | 'meta'
  | 'stream'
  | 'subtitles'
  | 'addon_catalog';

export type StremioResource =
  | string
  | {
      name: string;
      types?: string[];
      idPrefixes?: string[];
    };

export interface StremioManifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  logo?: string;
  background?: string;
  resources?: StremioResource[];
  types?: string[];
  catalogs?: Array<Record<string, unknown>>;
  behaviorHints?: {
    configurable?: boolean;
    configurationRequired?: boolean;
    [key: string]: unknown;
  };
}

export interface InstalledAddon {
  manifestUrl: string;
  baseUrl: string;
  manifest: StremioManifest;
  enabled: boolean;
  addedAt: number;
}

export interface AddonProtocolRequest {
  manifestUrl: string;
  resource: AddonProtocolResource;
  type?: string;
  id?: string;
  catalogId?: string;
}

export interface AddonProtocolResponse<T = unknown> {
  statusCode: number;
  headers: Record<string, string>;
  finalUrl: string;
  body: T;
}

export interface AddonStreamLoadError {
  addonId: string;
  addonName: string;
  url: string;
  message: string;
}

export interface AddonCatalogItem {
  id: string;
  type: string;
  name: string;
  poster?: string;
  description?: string;
  year?: number;
}

export interface AddonMeta {
  id: string;
  type: string;
  name?: string;
  poster?: string;
  background?: string;
  description?: string;
  year?: number;
  [key: string]: unknown;
}

export interface AddonSubtitle {
  id: string;
  url: string;
  lang?: string;
  label?: string;
  addonId: string;
  addonName: string;
}
