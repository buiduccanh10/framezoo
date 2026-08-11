export type MediaType = 'movie' | 'show';

export interface MediaItem {
  id: string;
  title: string;
  type: MediaType;
  year?: number;
  releaseDate?: string;
  poster?: string;
  backdrop?: string;
  logo?: string;
  overview?: string;
  genres?: string[];
  rating?: number;
  voteCount?: number;
  numberOfSeasons?: number;
  runtime?: number;
  language?: string;
  director?: string;
  actors?: string[];
  imdbId?: string;
  collection?: {
    id: string;
    name: string;
    poster?: string;
    backdrop?: string;
  };
}

export interface Episode {
  id: string;
  number: number;
  title: string;
  overview?: string;
  stillPath?: string;
  airDate?: string;
  rating?: number;
  voteCount?: number;
}

export interface Season {
  id: string;
  number: number;
  title: string;
  episodes: Episode[];
  episodeCount?: number;
  overview?: string;
  airDate?: string;
  poster?: string;
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
