import type { MediaType } from '@/types';

export type RootStackParamList = {
  Main: undefined;
  Auth: undefined;
  Details: { mediaId: string; type: MediaType };
  Player: { mediaId: string; type: MediaType; season?: number; episode?: number };
  Addons: undefined;
  Settings: undefined;
  Migration: undefined;
};

export type MainTabParamList = {
  Discover: undefined;
  Search: undefined;
  Library: undefined;
  Settings: undefined;
};
