import { create } from 'zustand';

import type { AccountWithToken } from '@/types';

interface AuthState {
  account: AccountWithToken | null;
  backendUrl: string;
  hydrated: boolean;
  setAccount: (account: AccountWithToken | null) => void;
  setBackendUrl: (url: string) => void;
  setHydrated: (hydrated: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  account: null,
  backendUrl: '',
  hydrated: false,
  setAccount: (account) => set({ account }),
  setBackendUrl: (backendUrl) => set({ backendUrl }),
  setHydrated: (hydrated) => set({ hydrated }),
}));
