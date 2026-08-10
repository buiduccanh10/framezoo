export type MediaType = 'movie' | 'show';

export interface MediaItem {
  id: string;
  title: string;
  type: MediaType;
  year?: number;
  releaseDate?: string;
  poster?: string;
  backdrop?: string;
  overview?: string;
  genres?: string[];
  rating?: number;
}

export interface Episode {
  id: string;
  number: number;
  title: string;
  overview?: string;
  stillPath?: string;
  airDate?: string;
}

export interface Season {
  id: string;
  number: number;
  title: string;
  episodes: Episode[];
}

export interface MediaDetails extends MediaItem {
  seasons?: Season[];
  cast?: Array<{ id: string; name: string; character?: string; image?: string }>;
  trailers?: Array<{ id: string; title: string; url: string; thumbnail?: string }>;
  similar?: MediaItem[];
  imdbId?: string;
}

export type SourceKind = 'hls' | 'mp4' | 'dash' | 'torrent' | 'file';

export interface SubtitleTrack {
  id: string;
  language: string;
  label?: string;
  url: string;
}

export interface AddonStream {
  id: string;
  addonId: string;
  addonName: string;
  kind: SourceKind;
  name: string;
  title: string;
  description?: string;
  url: string;
  infoHash?: string;
  fileIdx?: number;
  fileName?: string;
  videoSize?: number;
  subtitles: SubtitleTrack[];
  headers?: Record<string, string>;
}
