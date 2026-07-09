export interface StreamPreview {
  kind: 'vtt';
  vtt: string;
  sprite?: string;
}

export interface StreamLookupContext {
  title?: string;
  originName?: string;
  releaseYear?: number;
  country?: string;
}

export interface Stream {
  name: string;
  title: string;
  url: string;
  subtitle: string;
  quality: string;
  provider: string;
  variantId?: string;
  variantLabel?: string;
  streamType?: 'hls' | 'file' | 'dash';
  preview?: StreamPreview;
  headers: {
    Referer: string;
    'User-Agent': string;
    Origin: string;
  };
}
