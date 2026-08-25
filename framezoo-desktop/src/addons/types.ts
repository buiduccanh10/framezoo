export type AddonProtocolResource =
  | "catalog"
  | "meta"
  | "stream"
  | "subtitles"
  | "addon_catalog";

export interface AddonProtocolRequest {
  manifestUrl: string;
  resource: AddonProtocolResource;
  type?: string;
  id?: string;
  catalogId?: string;
  cacheBust?: string;
}

export interface AddonProtocolResponse<T = unknown> {
  statusCode: number;
  headers: Record<string, string>;
  finalUrl: string;
  body: T;
}
