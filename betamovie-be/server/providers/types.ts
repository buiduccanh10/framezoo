export interface StreamPreview {
  kind: 'vtt';
  vtt: string;
  sprite?: string;
}

export interface StreamLookupContext {
  title?: string;
  releaseYear?: number;
}

export interface Stream {
  name: string;
  title: string;
  url: string;
  subtitle: string;
  quality: string;
  provider: string;
  preview?: StreamPreview;
  headers: {
    Referer: string;
    'User-Agent': string;
    Origin: string;
  };
}
