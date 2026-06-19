import { useCallback } from "react";

import {
  SessionResponse,
  isAuthErrorStatus,
  withAuthRetry,
} from "@/backend/accounts/auth";
import { bookmarkMediaToInput } from "@/backend/accounts/bookmarks";
import {
  bytesToBase64,
  bytesToBase64Url,
  encryptData,
  getCredentialId,
  keysFromCredentialId,
  keysFromMnemonic,
  signChallenge,
  storeCredentialMapping,
} from "@/backend/accounts/crypto";
import { getGroupOrder } from "@/backend/accounts/groupOrder";
import { importBookmarks, importProgress } from "@/backend/accounts/import";
import { getLoginChallengeToken, loginAccount } from "@/backend/accounts/login";
import { progressMediaItemToInputs } from "@/backend/accounts/progress";
import {
  getRegisterChallengeToken,
  registerAccount,
} from "@/backend/accounts/register";
import { removeSession } from "@/backend/accounts/sessions";
import { getSettings } from "@/backend/accounts/settings";
import {
  UserResponse,
  getBookmarks,
  getProgress,
  getUser,
  getWatchHistory,
} from "@/backend/accounts/user";
import { useAuthData } from "@/hooks/auth/useAuthData";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { AccountWithToken, useAuthStore } from "@/stores/auth";
import { BookmarkMediaItem } from "@/stores/bookmarks";
import { ProgressMediaItem } from "@/stores/progress";

export interface RegistrationData {
  recaptchaToken?: string;
  mnemonic?: string;
  credentialId?: string;
  nickname?: string;
  password?: string;
  userData: {
    inviteCode: string;
    profile: {
      colorA: string;
      colorB: string;
      icon: string;
    };
  };
}

export interface LoginData {
  mnemonic?: string;
  credentialId?: string;
  nickname?: string;
  password?: string;
  userData: {
    // device name removed from UI
  };
}

export function useAuth() {
  const currentAccount = useAuthStore((s) => s.account);
  const profile = useAuthStore((s) => s.account?.profile);
  const loggedIn = !!useAuthStore((s) => s.account);
  const backendUrl = useBackendUrl();
  const {
    logout: userDataLogout,
    login: userDataLogin,
    syncData,
  } = useAuthData();

  const login = useCallback(
    async (loginData: LoginData) => {
      if (!backendUrl) return;

      // Support both old (mnemonic/credentialId) and new (nickname/password) auth methods
      let keys: any;
      let publicKeyBase64Url: string;
      let nickname: string | undefined;

      if (loginData.nickname && loginData.password) {
        // New method: nickname + password (password is mnemonic/passphrase)
        keys = await keysFromMnemonic(loginData.password);
        publicKeyBase64Url = bytesToBase64Url(keys.publicKey);
        nickname = loginData.nickname;

        // Get challenge using nickname
        const challengeResponse = await getLoginChallengeToken(
          backendUrl,
          nickname,
        );
        const { challenge, publicKey: returnedPublicKey } = challengeResponse;

        const signature = await signChallenge(keys, challenge);
        const loginResult = await loginAccount(backendUrl, {
          nickname,
          publicKey: returnedPublicKey || publicKeyBase64Url,
          challenge: {
            code: challenge,
            signature,
          },
          device: await encryptData("Browser", keys.seed),
        });

        const user = await getUser(backendUrl);
        const seedBase64 = bytesToBase64(keys.seed);

        return userDataLogin(loginResult, user.user, user.session, seedBase64);
      } else if (loginData.mnemonic || loginData.credentialId) {
        // Old method: mnemonic or credentialId
        if (!loginData.mnemonic && !loginData.credentialId) {
          throw new Error("Either mnemonic or credentialId must be provided");
        }

        keys = loginData.credentialId
          ? await keysFromCredentialId(loginData.credentialId)
          : await keysFromMnemonic(loginData.mnemonic!);
        publicKeyBase64Url = bytesToBase64Url(keys.publicKey);

        // Try to get credential ID from storage if using mnemonic
        let credentialId: string | null = null;
        if (loginData.mnemonic) {
          credentialId = getCredentialId(backendUrl, publicKeyBase64Url);
        } else {
          credentialId = loginData.credentialId || null;
        }

        const { challenge } = await getLoginChallengeToken(
          backendUrl,
          publicKeyBase64Url,
        );
        const signature = await signChallenge(keys, challenge);
        const loginResult = await loginAccount(backendUrl, {
          publicKey: publicKeyBase64Url,
          challenge: {
            code: challenge,
            signature,
          },
          device: await encryptData("Browser", keys.seed),
        });

        const user = await getUser(backendUrl);
        const seedBase64 = bytesToBase64(keys.seed);

        // Store credential mapping if we have a credential ID
        if (credentialId) {
          storeCredentialMapping(backendUrl, publicKeyBase64Url, credentialId);
        }

        return userDataLogin(loginResult, user.user, user.session, seedBase64);
      } else {
        throw new Error(
          "Either nickname/password or mnemonic/credentialId must be provided",
        );
      }
    },
    [userDataLogin, backendUrl],
  );

  const logout = useCallback(async () => {
    if (!currentAccount || !backendUrl) return;
    try {
      await removeSession(backendUrl, currentAccount, currentAccount.sessionId);
    } catch {
      // we dont care about failing to delete session
    }
    await userDataLogout();
  }, [userDataLogout, backendUrl, currentAccount]);

  const disconnectFromBackend = useCallback(async () => {
    if (!currentAccount || !backendUrl) return;
    try {
      await removeSession(backendUrl, currentAccount, currentAccount.sessionId);
    } catch {
      // we dont care about failing to delete session
    }
    // Only remove the account, keep all local data
    useAuthStore.getState().removeAccount();
  }, [backendUrl, currentAccount]);

  const register = useCallback(
    async (registerData: RegistrationData) => {
      if (!backendUrl) return;

      // Support both old (mnemonic/credentialId) and new (nickname/password) auth methods
      let keys: any;
      let publicKeyBase64Url: string;
      let nickname: string | undefined;

      if (registerData.nickname && registerData.password) {
        // New method: nickname + password (password is mnemonic/passphrase)
        keys = await keysFromMnemonic(registerData.password);
        publicKeyBase64Url = bytesToBase64Url(keys.publicKey);
        nickname = registerData.nickname;

        const { challenge } = await getRegisterChallengeToken(
          backendUrl,
          registerData.recaptchaToken,
        );
        const signature = await signChallenge(keys, challenge);
        const registerResult = await registerAccount(backendUrl, {
          challenge: {
            code: challenge,
            signature,
          },
          publicKey: publicKeyBase64Url,
          nickname: nickname,
          inviteCode: registerData.userData.inviteCode,
          device: await encryptData("Browser", keys.seed),
          profile: registerData.userData.profile,
        });

        return userDataLogin(
          registerResult,
          registerResult.user,
          registerResult.session,
          bytesToBase64(keys.seed),
        );
      } else if (registerData.mnemonic || registerData.credentialId) {
        // Old method: mnemonic or credentialId
        if (!registerData.mnemonic && !registerData.credentialId) {
          throw new Error("Either mnemonic or credentialId must be provided");
        }

        const { challenge } = await getRegisterChallengeToken(
          backendUrl,
          registerData.recaptchaToken,
        );
        keys = registerData.credentialId
          ? await keysFromCredentialId(registerData.credentialId)
          : await keysFromMnemonic(registerData.mnemonic!);
        const signature = await signChallenge(keys, challenge);
        publicKeyBase64Url = bytesToBase64Url(keys.publicKey);
        const registerResult = await registerAccount(backendUrl, {
          challenge: {
            code: challenge,
            signature,
          },
          publicKey: publicKeyBase64Url,
          nickname: registerData.nickname ?? "",
          inviteCode: registerData.userData.inviteCode,
          device: await encryptData("Browser", keys.seed),
          profile: registerData.userData.profile,
        });

        // Store credential mapping if we have a credential ID
        if (registerData.credentialId) {
          storeCredentialMapping(
            backendUrl,
            publicKeyBase64Url,
            registerData.credentialId,
          );
        }

        return userDataLogin(
          registerResult,
          registerResult.user,
          registerResult.session,
          bytesToBase64(keys.seed),
        );
      } else {
        throw new Error(
          "Either nickname/password or mnemonic/credentialId must be provided",
        );
      }
    },
    [backendUrl, userDataLogin],
  );

  const importData = useCallback(
    async (
      account: AccountWithToken,
      progressItems: Record<string, ProgressMediaItem>,
      bookmarks: Record<string, BookmarkMediaItem>,
    ) => {
      if (!backendUrl) return;
      if (
        Object.keys(progressItems).length === 0 &&
        Object.keys(bookmarks).length === 0
      ) {
        return;
      }

      const progressInputs = Object.entries(progressItems).flatMap(
        ([tmdbId, item]) => progressMediaItemToInputs(tmdbId, item),
      );

      const bookmarkInputs = Object.entries(bookmarks).map(([tmdbId, item]) =>
        bookmarkMediaToInput(tmdbId, item),
      );

      await Promise.all([
        importProgress(backendUrl, account, progressInputs),
        importBookmarks(backendUrl, account, bookmarkInputs),
      ]);
    },
    [backendUrl],
  );

  const restore = useCallback(
    async (account: AccountWithToken) => {
      if (!backendUrl) return;
      const { setAccount } = useAuthStore.getState();

      let activeAccount = account;

      let user: { user: UserResponse; session: SessionResponse };

      try {
        user = await withAuthRetry(backendUrl, activeAccount, (token) =>
          getUser(backendUrl, token),
        );
        activeAccount = useAuthStore.getState().account ?? activeAccount;
      } catch (err) {
        const anyError: any = err;
        const status =
          anyError?.response?.status ??
          anyError?.status ??
          anyError?.statusCode;

        if (isAuthErrorStatus(status)) {
          try {
            // Keep local auth state intact on restore failure and retry with
            // cookie-only auth before surfacing an error to the loading screen.
            user = await getUser(backendUrl);
          } catch (cookieErr) {
            const cookieStatus =
              (cookieErr as any)?.response?.status ??
              (cookieErr as any)?.status ??
              (cookieErr as any)?.statusCode;

            if (isAuthErrorStatus(cookieStatus)) {
              throw cookieErr;
            }

            console.error(cookieErr);
            throw cookieErr;
          }
        } else {
          console.error(err);
          throw err;
        }
      }

      const [bookmarks, progress, watchHistory, settings, groupOrder] =
        await Promise.all([
          getBookmarks(backendUrl, activeAccount),
          getProgress(backendUrl, activeAccount),
          getWatchHistory(backendUrl, activeAccount),
          getSettings(backendUrl, activeAccount),
          getGroupOrder(backendUrl, activeAccount),
        ]);

      setAccount({
        ...activeAccount,
        nickname: user.user.nickname,
        profile: user.user.profile,
      });

      syncData(
        user.user,
        user.session,
        progress,
        bookmarks,
        watchHistory,
        settings,
        groupOrder,
      );
    },
    [backendUrl, syncData],
  );
  return {
    loggedIn,
    profile,
    login,
    logout,
    disconnectFromBackend,
    register,
    restore,
    importData,
  };
}
