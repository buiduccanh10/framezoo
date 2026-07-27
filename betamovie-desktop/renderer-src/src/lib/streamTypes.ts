export type Qualities =
  | "360"
  | "480"
  | "720"
  | "1080"
  | "1440"
  | "4k"
  | "unknown";

export type Caption = {
  id: string;
  type: string;
  url: string;
  language: string;
  hasCorsRestrictions: boolean;
  [key: string]: any;
};

export type StreamHeaders = Record<string, string>;

type BaseStream = {
  id?: string;
  captions: Caption[];
  headers?: StreamHeaders;
  preferredHeaders?: StreamHeaders;
  flags?: string[];
  skipValidation?: boolean;
  [key: string]: any;
};

type HlsStream = BaseStream & {
  type: "hls";
  playlist: string;
};

type DashStream = BaseStream & {
  type: "dash";
  manifest: string;
};

type FileStream = BaseStream & {
  type: "file";
  qualities: Record<string, { type: "mp4"; url: string }>;
};

export type Stream = HlsStream | DashStream | FileStream;
