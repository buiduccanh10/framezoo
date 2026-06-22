import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import { MediaItem } from "@/utils/mediaTypes";

export type StoredListItemType = "movie" | "tv" | null;

export interface StoredListItemRef {
  id: string;
  listId: string;
  tmdbId: string;
  type: StoredListItemType;
  addedAt: number;
}

export interface StoredList {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  public: boolean;
  createdAt: number;
  updatedAt: number;
  items: StoredListItemRef[];
}

export interface HydratedListItem {
  ref: StoredListItemRef;
  media: MediaItem;
  canShowDetails: boolean;
}

interface ListStore {
  lists: Record<string, StoredList>;
  replaceLists(lists: Record<string, StoredList>): void;
  upsertList(list: StoredList): void;
  removeList(id: string): void;
  clear(): void;
}

export const useListStore = create(
  persist(
    immer<ListStore>((set) => ({
      lists: {},
      replaceLists(lists) {
        set((state) => {
          state.lists = lists;
        });
      },
      upsertList(list) {
        set((state) => {
          state.lists[list.id] = list;
        });
      },
      removeList(id) {
        set((state) => {
          delete state.lists[id];
        });
      },
      clear() {
        set((state) => {
          state.lists = {};
        });
      },
    })),
    {
      name: "__MW::lists",
    },
  ),
);
