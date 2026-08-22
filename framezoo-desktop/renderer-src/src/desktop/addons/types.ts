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
  isNative?: boolean;
}

export interface StremioSubtitle {
  id?: string;
  url?: string;
  lang?: string;
  language?: string;
  label?: string;
  source?: string;
  type?: string;
  isHearingImpaired?: boolean;
  encoding?: string;
}

export interface StremioStream {
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
    proxyHeaders?: {
      request?: Record<string, string>;
      response?: Record<string, string>;
    };
    [key: string]: unknown;
  };
  subtitles?: StremioSubtitle[];
  sources?: string[];
  [key: string]: unknown;
}

export interface StremioStreamResponse {
  streams?: StremioStream[];
}

export interface AddonStreamLoadError {
  addonId: string;
  addonName: string;
  url: string;
  message: string;
}

export interface AddonStreamLoadResult {
  streams: AddonStream[];
  errors: AddonStreamLoadError[];
}

export type AddonStreamKind = "torrent" | "hls" | "dash" | "file";

export interface AddonStream {
  id: string;
  addonId: string;
  addonName: string;
  kind: AddonStreamKind;
  name: string;
  title: string;
  description: string;
  url: string;
  infoHash: string | null;
  trackers?: string[];
  fileIdx: number | null;
  fileName: string | null;
  videoSize: number | null;
  subtitles: StremioSubtitle[];
  headers?: Record<string, string>;
  bingeGroup?: string;
}
