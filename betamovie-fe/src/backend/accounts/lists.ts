import { ofetch } from "ofetch";

import { getAuthHeaders, withAuthRetry } from "@/backend/accounts/auth";
import { getMediaDetails, getMediaPoster } from "@/backend/metadata/tmdb";
import {
  TMDBContentTypes,
  TMDBMovieData,
  TMDBShowData,
} from "@/backend/metadata/types/tmdb";
import { AccountWithToken } from "@/stores/auth";
import {
  HydratedListItem,
  StoredList,
  StoredListItemRef,
} from "@/stores/lists";
import {
  ListMembershipUpdate,
  RawListResponse,
  fallbackHydratedListItem,
  normalizeListResponse,
  normalizeListResponses,
} from "@/stores/lists/utils";
import { MediaItem } from "@/utils/mediaTypes";

export interface ListItemInput {
  tmdb_id: string;
  type: "movie" | "tv";
}

export interface CreateListInput {
  name: string;
  description?: string | null;
  public?: boolean;
  items?: ListItemInput[];
}

export interface UpdateListInput extends ListMembershipUpdate {
  name?: string;
  description?: string | null;
  public?: boolean;
}

function formatListMediaItem(
  details: TMDBMovieData | TMDBShowData,
  type: "movie" | "tv",
): MediaItem {
  if (type === "tv") {
    const show = details as TMDBShowData;
    return {
      id: show.id.toString(),
      title: show.name,
      year: show.first_air_date
        ? new Date(show.first_air_date).getFullYear()
        : undefined,
      release_date: show.first_air_date
        ? new Date(show.first_air_date)
        : undefined,
      poster: getMediaPoster(show.poster_path),
      type: "show",
    };
  }

  const movie = details as TMDBMovieData;
  return {
    id: movie.id.toString(),
    title: movie.title,
    year: movie.release_date
      ? new Date(movie.release_date).getFullYear()
      : undefined,
    release_date: movie.release_date ? new Date(movie.release_date) : undefined,
    poster: getMediaPoster(movie.poster_path),
    type: "movie",
  };
}

export async function hydrateListItemRef(
  item: StoredListItemRef,
): Promise<HydratedListItem> {
  if (!item.type) {
    return fallbackHydratedListItem(item);
  }

  try {
    const details = await getMediaDetails(
      item.tmdbId,
      item.type === "tv" ? TMDBContentTypes.TV : TMDBContentTypes.MOVIE,
      false,
    );

    return {
      ref: item,
      media: formatListMediaItem(details, item.type),
      canShowDetails: true,
    };
  } catch (error) {
    console.error("Failed to hydrate list item", {
      tmdbId: item.tmdbId,
      type: item.type,
      error,
    });
    return fallbackHydratedListItem(item);
  }
}

export async function hydrateListItems(
  items: StoredListItemRef[],
): Promise<HydratedListItem[]> {
  return Promise.all(items.map((item) => hydrateListItemRef(item)));
}

export async function getLists(
  url: string,
  account: AccountWithToken,
): Promise<Record<string, StoredList>> {
  return withAuthRetry(url, account, (token) =>
    ofetch<{ lists: RawListResponse[] }>(`/users/${account.userId}/lists`, {
      credentials: "include",
      headers: getAuthHeaders(token),
      baseURL: url,
    }).then((response) => normalizeListResponses(response.lists)),
  );
}

export async function createList(
  url: string,
  account: AccountWithToken,
  input: CreateListInput,
): Promise<StoredList> {
  return withAuthRetry(url, account, (token) =>
    ofetch<{ list: RawListResponse }>(`/users/${account.userId}/lists`, {
      method: "POST",
      credentials: "include",
      headers: getAuthHeaders(token),
      baseURL: url,
      body: input,
    }).then((response) => normalizeListResponse(response.list)),
  );
}

export async function updateList(
  url: string,
  account: AccountWithToken,
  input: UpdateListInput,
): Promise<StoredList> {
  return withAuthRetry(url, account, (token) =>
    ofetch<{ list: RawListResponse }>(`/users/${account.userId}/lists`, {
      method: "PATCH",
      credentials: "include",
      headers: getAuthHeaders(token),
      baseURL: url,
      body: input,
    }).then((response) => normalizeListResponse(response.list)),
  );
}

export async function deleteList(
  url: string,
  account: AccountWithToken,
  listId: string,
): Promise<{ id: string }> {
  return withAuthRetry(url, account, (token) =>
    ofetch<{ id: string }>(`/users/${account.userId}/lists/${listId}`, {
      method: "DELETE",
      credentials: "include",
      headers: getAuthHeaders(token),
      baseURL: url,
    }),
  );
}

export async function getPublicList(
  url: string,
  listId: string,
): Promise<StoredList> {
  const response = await ofetch<RawListResponse>(`/lists/${listId}`, {
    credentials: "include",
    baseURL: url,
  });

  return normalizeListResponse(response);
}

export { formatListMediaItem };
