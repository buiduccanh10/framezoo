import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import {
  hasSecureSessionSupport,
  loadAuthSecrets,
  removeAuthSecrets,
  saveAuthSecrets,
} from "./secureSession";

export interface Account {
  profile: {
    colorA: string;
    colorB: string;
    icon: string;
  };
  nickname: string;
  email?: string | null;
}

export type AccountWithToken = Account & {
  sessionId: string;
  userId: string;
  token?: string;
  refreshToken?: string;
  seed: string;
  deviceName: string;
};

interface AuthStore {
  account: null | AccountWithToken;
  authHydrated: boolean;
  backendUrl: null | string;
  proxySet: null | string[];
  removeAccount(): void;
  setAccount(acc: AccountWithToken): void;
  updateDeviceName(deviceName: string): void;
  updateAccount(acc: Partial<Account>): void;
  setAccountProfile(acc: Account["profile"]): void;
  setAccountNickname(nickname: string): void;
  setBackendUrl(url: null | string): void;
  setProxySet(urls: null | string[]): void;
  hydrateAuthSecrets(): Promise<void>;
}

export const useAuthStore = create(
  persist(
    immer<AuthStore>((set) => ({
      account: null,
      authHydrated: false,
      backendUrl: null,
      proxySet: null,
      setAccount(acc) {
        set((s) => {
          s.account = acc;
        });
        void saveAuthSecrets(acc);
      },
      removeAccount() {
        set((s) => {
          s.account = null;
        });
        void removeAuthSecrets();
      },
      setBackendUrl(v) {
        set((s) => {
          s.backendUrl = v;
        });
      },
      setProxySet(urls) {
        set((s) => {
          s.proxySet = urls;
        });
      },
      async hydrateAuthSecrets() {
        if (!hasSecureSessionSupport()) {
          set((s) => {
            s.authHydrated = true;
          });
          return;
        }

        const current = useAuthStore.getState().account;
        if (!current) {
          set((s) => {
            s.authHydrated = true;
          });
          return;
        }

        const stored = await loadAuthSecrets();
        const secure =
          stored &&
          stored.userId === current.userId &&
          stored.sessionId === current.sessionId
            ? stored
            : null;
        const legacy = {
          token: current.token,
          refreshToken: current.refreshToken,
          seed: current.seed,
        };
        const secrets = secure ?? legacy;
        if (stored && !secure) {
          await removeAuthSecrets();
        }
        if (!secure && (legacy.token || legacy.refreshToken || legacy.seed)) {
          await saveAuthSecrets(current);
        }

        set((s) => {
          if (
            s.account?.userId !== current.userId ||
            s.account.sessionId !== current.sessionId
          ) {
            return;
          }
          s.account = { ...s.account, ...secrets };
          s.authHydrated = true;
        });
      },
      setAccountProfile(profile) {
        set((s) => {
          if (s.account) {
            s.account.profile = profile;
          }
        });
      },
      setAccountNickname(nickname) {
        set((s) => {
          if (s.account) {
            s.account.nickname = nickname;
          }
        });
      },
      updateAccount(acc) {
        set((s) => {
          if (!s.account) return;
          s.account = {
            ...s.account,
            ...acc,
          };
        });
      },
      updateDeviceName(deviceName) {
        set((s) => {
          if (!s.account) return;
          s.account.deviceName = deviceName;
        });
      },
    })),
    {
      name: "__MW::auth",
      partialize: (state) => {
        if (!hasSecureSessionSupport()) {
          return {
            account: state.account,
            backendUrl: state.backendUrl,
            proxySet: state.proxySet,
          };
        }

        const account = state.account;
        if (!account) {
          return {
            account: null,
            backendUrl: state.backendUrl,
            proxySet: state.proxySet,
          };
        }

        const {
          token: _token,
          refreshToken: _refreshToken,
          seed: _seed,
          ...metadata
        } = account;
        return {
          account: { ...metadata, seed: "" },
          backendUrl: state.backendUrl,
          proxySet: state.proxySet,
        };
      },
    },
  ),
);
