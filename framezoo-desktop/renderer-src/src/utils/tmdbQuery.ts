import { get } from "@/backend/metadata/tmdb";

type TMDBParams = Record<string, unknown> | undefined;

export function fetchCachedTmdb<T>(
  url: string,
  params?: TMDBParams,
): Promise<T> {
  return get<T>(url, params);
}
