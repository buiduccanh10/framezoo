export interface StremioSubtitle {
  id: string;
  url: string;
  lang: string;
  label?: string;
  source?: string;
  type?: string;
  isHearingImpaired?: boolean;
  encoding?: string;
}

export interface StremioSubtitleResponse {
  subtitles: StremioSubtitle[];
}

export interface SubtitleSearchContext {
  type: 'movie' | 'series';
  id: string;
  imdbId?: string;
  tmdbId?: number;
  season?: number;
  episode?: number;
  title?: string;
  releaseYear?: number;
  language?: string;
}
