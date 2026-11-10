import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import {
  hasSecureSessionSupport,
  loadAuthSecrets,
  recoverSeedFromSavedLogin,
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
        let next = acc;
        set((s) => {
          const prev = s.account;
          // Callers often spread an account snapshot taken before secrets
          // were hydrated (seed/token are stripped from localStorage). Keep
          // the in-memory secrets instead of wiping them with empty values.
          if (
            prev &&
            prev.userId === acc.userId &&
            prev.sessionId === acc.sessionId
          ) {
            next = {
              ...acc,
              seed: acc.seed || prev.seed,
              token: acc.token || prev.token,
              refreshToken: acc.refreshToken || prev.refreshToken,
            };
          }
          s.account = next;
        });
        void saveAuthSecrets(next);
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
        if (stored && !secure) {
          await removeAuthSecrets();
        }
        // Merge field by field so an empty stored value never wipes a value
        // that is still available elsewhere.
        const secrets = {
          token: secure?.token || legacy.token,
          refreshToken: secure?.refreshToken || legacy.refreshToken,
          seed: secure?.seed || legacy.seed,
        };
        let recoveredSeed = false;
        if (!secrets.seed) {
          // Seed lost (overwritten by an older build or unreadable after an
          // update): rebuild it from the remembered login, if verifiable.
          const seed = await recoverSeedFromSavedLogin(current);
          if (seed) {
            secrets.seed = seed;
            recoveredSeed = true;
          }
        }
        if (
          (!secure || recoveredSeed) &&
          (secrets.token || secrets.refreshToken || secrets.seed)
        ) {
          await saveAuthSecrets({ ...current, ...secrets });
        }

        set((s) => {
          if (
            s.account?.userId !== current.userId ||
            s.account.sessionId !== current.sessionId
          ) {
            return;
          }
          s.account = {
            ...s.account,
            token: s.account.token || secrets.token,
            refreshToken: s.account.refreshToken || secrets.refreshToken,
            seed: s.account.seed || secrets.seed,
          };
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
