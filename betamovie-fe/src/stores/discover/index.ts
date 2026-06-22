import { create } from "zustand";
import { persist } from "zustand/middleware";

export type GenreCategory = `genre:${string}`;

export type Category =
  | "movies"
  | "tvshows"
  | "popular"
  | "editorpicks"
  | "top10"
  | GenreCategory;

interface DiscoverView {
  url: string;
  scrollPosition: number;
}

interface DiscoverState {
  selectedCategory: Category;
  lastView: DiscoverView | null;
  setSelectedCategory: (category: Category) => void;
  setLastView: (view: DiscoverView) => void;
  clearLastView: () => void;
}

export const useDiscoverStore = create<DiscoverState>()(
  persist(
    (set) => ({
      selectedCategory: "tvshows",
      lastView: null,
      setSelectedCategory: (category) => set({ selectedCategory: category }),
      setLastView: (view) => set({ lastView: view }),
      clearLastView: () => set({ lastView: null }),
    }),
    {
      name: "__MW::discover",
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        if (!persistedState || typeof persistedState !== "object") {
          return persistedState;
        }

        const state = persistedState as Partial<DiscoverState>;
        let selectedCategory = state.selectedCategory;

        if (version < 1 && selectedCategory === "movies") {
          selectedCategory = "tvshows";
        }

        if (
          version < 2 &&
          (selectedCategory === "top10" || selectedCategory === "editorpicks")
        ) {
          selectedCategory = "popular";
        }

        return {
          ...state,
          selectedCategory,
        };
      },
    },
  ),
);
