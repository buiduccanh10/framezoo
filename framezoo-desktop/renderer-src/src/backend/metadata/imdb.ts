import { ofetch } from "ofetch";

import { conf } from "@/setup/config";

export interface IMDbMetadata {
  title?: string;
  original_title?: string;
  title_type?: string;
  year?: number | null;
  end_year?: number | null;
  day?: number | null;
  month?: number | null;
  date?: string;
  runtime?: number | null;
  age_rating?: string;
  imdb_rating?: number | null;
  votes?: number | null;
  plot?: string;
  poster_url?: string;
  trailer_url?: string;
  trailer_thumbnail?: string;
  url?: string;
  genre?: string[];
  cast?: string[];
  directors?: string[];
  writers?: string[];
  keywords?: string[];
  countries?: string[];
  languages?: string[];
  locations?: string[];
  season?: number;
  episode?: number;
  episode_title?: string;
  episode_plot?: string;
  episode_rating?: number;
  episode_votes?: number;
}

export async function getIMDbMetadata(
  imdbId: string,
  season?: number,
  episode?: number,
  language?: string,
): Promise<IMDbMetadata | null> {
  const backendUrl = conf().BACKEND_URL;
  if (!backendUrl) return null;

  return ofetch<IMDbMetadata>("/imdb/title", {
    baseURL: backendUrl,
    credentials: "include",
    query: {
      imdbId,
      ...(season ? { season } : {}),
      ...(episode ? { episode } : {}),
      ...(language ? { language } : {}),
    },
  });
}
