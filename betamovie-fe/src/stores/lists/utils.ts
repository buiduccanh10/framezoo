import {
  HydratedListItem,
  StoredList,
  StoredListItemRef,
  StoredListItemType,
} from "@/stores/lists";

export interface RawListItemResponse {
  id: string;
  list_id: string;
  tmdb_id: string;
  type?: string | null;
  added_at: string;
}

export interface RawListResponse {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  public: boolean;
  list_items: RawListItemResponse[];
}

export interface ListMutationItemInput {
  tmdb_id: string;
  type: "movie" | "tv";
}

export interface ListMembershipUpdate {
  list_id: string;
  addItems?: ListMutationItemInput[];
  removeItems?: ListMutationItemInput[];
}

function normalizeListItemType(type?: string | null): StoredListItemType {
  if (type === "movie" || type === "tv") {
    return type;
  }

  return null;
}

export function normalizeListItemResponse(
  item: RawListItemResponse,
): StoredListItemRef {
  return {
    id: item.id,
    listId: item.list_id,
    tmdbId: item.tmdb_id,
    type: normalizeListItemType(item.type),
    addedAt: new Date(item.added_at).getTime(),
  };
}

export function normalizeListResponse(raw: RawListResponse): StoredList {
  return {
    id: raw.id,
    userId: raw.user_id,
    name: raw.name,
    description: raw.description,
    public: raw.public,
    createdAt: new Date(raw.created_at).getTime(),
    updatedAt: new Date(raw.updated_at).getTime(),
    items: raw.list_items
      .map(normalizeListItemResponse)
      .sort((a, b) => b.addedAt - a.addedAt),
  };
}

export function normalizeListResponses(
  lists: RawListResponse[],
): Record<string, StoredList> {
  return Object.fromEntries(
    lists.map((list) => {
      const normalized = normalizeListResponse(list);
      return [normalized.id, normalized] as const;
    }),
  );
}

export function sortStoredLists(lists: StoredList[]): StoredList[] {
  return [...lists].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function buildListMembershipUpdates(
  lists: StoredList[] | Record<string, StoredList>,
  tmdbId: string,
  type: "movie" | "tv",
  desiredListIds: string[],
): ListMembershipUpdate[] {
  const allLists = Array.isArray(lists) ? lists : Object.values(lists);
  const desiredSet = new Set(desiredListIds);
  const itemPayload: ListMutationItemInput = { tmdb_id: tmdbId, type };

  return allLists.reduce<ListMembershipUpdate[]>((updates, list) => {
    const hasItem = list.items.some((item) => item.tmdbId === tmdbId);
    const shouldHaveItem = desiredSet.has(list.id);

    if (hasItem === shouldHaveItem) {
      return updates;
    }

    if (shouldHaveItem) {
      updates.push({
        list_id: list.id,
        addItems: [itemPayload],
      });
      return updates;
    }

    updates.push({
      list_id: list.id,
      removeItems: [itemPayload],
    });
    return updates;
  }, []);
}

export function getListSharePath(listId: string): string {
  return `/lists/${listId}`;
}

export function getListShareUrl(listId: string, origin: string): string {
  return `${origin}${getListSharePath(listId)}`;
}

export function fallbackHydratedListItem(
  ref: StoredListItemRef,
): HydratedListItem {
  return {
    ref,
    media: {
      id: ref.tmdbId,
      title: `TMDB #${ref.tmdbId}`,
      type: ref.type === "tv" ? "show" : "movie",
    },
    canShowDetails: ref.type !== null,
  };
}
