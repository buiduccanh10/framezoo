import { create } from 'zustand';

export type DiscoverCategory =
  | 'movies'
  | 'tvshows'
  | 'popular'
  | 'top10'
  | 'addons'
  | `genre:${string}`;

interface DiscoverState {
  category: DiscoverCategory;
  setCategory: (category: DiscoverCategory) => void;
}

export const useDiscoverStore = create<DiscoverState>(set => ({
  category: 'popular',
  setCategory: category => set({ category }),
}));
