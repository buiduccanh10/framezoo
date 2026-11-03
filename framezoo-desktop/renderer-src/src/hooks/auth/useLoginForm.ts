import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import type { AsyncReturnType } from "type-fest";

import {
  authenticatePasskey,
  verifyValidMnemonic,
} from "@/backend/accounts/crypto";
import { useAuth } from "@/hooks/auth/useAuth";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { PasswordInputData } from "@/pages/parts/auth/PasswordInputPart";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useToastStore } from "@/stores/interface/toast";
import { useProgressStore } from "@/stores/progress";

export function useLoginForm(onLogin?: () => void) {
  const { login, restore, importData } = useAuth();
  const progressItems = useProgressStore((store) => store.items);
  const bookmarkItems = useBookmarkStore((store) => store.bookmarks);
  const backendUrl = useBackendUrl();
  const { t } = useTranslation();
  const showToast = useToastStore((s) => s.showToast);

  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);

  const getFriendlyLoginError = (error: unknown): string => {
    const anyErr = error as any;
    const status =
      anyErr?.status ?? anyErr?.statusCode ?? anyErr?.response?.status;
    const message = String(
      anyErr?.data?.message ??
        anyErr?.response?._data?.message ??
        anyErr?.response?.statusText ??
        anyErr?.message ??
        "",
    ).toLowerCase();

    if (message.includes("no backend url")) {
      return t("auth.login.noBackendUrl") ?? "No backend URL";
    }

    if (
      status === 400 ||
      status === 401 ||
      status === 403 ||
      status === 404 ||
      message.includes("user cannot be found") ||
      message.includes("user not found") ||
      message.includes("invalid signature") ||
      message.includes("invalid challenge") ||
      message.includes("challenge code expired") ||
      message.includes("invalid request body") ||
      message.includes("unauthorized") ||
      message.includes("forbidden") ||
      message.includes("failed to authenticate with passkey") ||
      message.includes("notallowederror")
    ) {
      const validationMessage =
        t("auth.login.validationError") ?? "Incorrect or incomplete password";
      return validationMessage;
    }

    return t("auth.login.failedToReachServer") ?? "Failed to reach server";
  };

  const [passkeyResult, executePasskey] = useAsyncFn(async () => {
    if (!backendUrl) {
      throw new Error(t("auth.login.noBackendUrl") ?? "No backend URL");
    }

    const assertion = await authenticatePasskey();
    const credentialId = assertion.id;

    let account: AsyncReturnType<typeof login>;
    try {
      account = await login({
        credentialId,
        userData: {
          device: "Browser",
        },
      });
    } catch (err) {
      if ((err as any).status === 401)
        throw new Error(t("auth.login.validationError") ?? undefined);
      throw err;
    }

    if (!account) throw new Error(t("auth.login.validationError") ?? undefined);

    await importData(account, progressItems, bookmarkItems);
    await restore(account);
    onLogin?.();
  }, [
    backendUrl,
    bookmarkItems,
    importData,
    login,
    onLogin,
    progressItems,
    restore,
    t,
  ]);

  const [result, execute] = useAsyncFn(
    async (data: PasswordInputData) => {
      setNicknameError(null);
      setPasswordError(null);

      if (!verifyValidMnemonic(data.password)) {
        throw new Error(t("auth.login.validationError") ?? undefined);
      }

      let account: AsyncReturnType<typeof login>;
      try {
        account = await login({
          identifier: data.nickname,
          password: data.password,
          userData: {
            device: "Browser",
          },
        });
      } catch (err) {
        const anyErr: any = err;
        const status = anyErr?.response?.status;
        const beMessage: string =
          anyErr?.response?._data?.message ?? anyErr?.message ?? "";

        if (
          status === 400 ||
          status === 401 ||
          status === 403 ||
          status === 404 ||
          beMessage.toLowerCase().includes("user") ||
          beMessage.toLowerCase().includes("invalid") ||
          beMessage.toLowerCase().includes("signature") ||
          beMessage.toLowerCase().includes("credential")
        ) {
          const invalidMsg =
            t("auth.login.invalidCredentials") ??
            "Username or password is incorrect";
          setPasswordError(invalidMsg);
          showToast(invalidMsg, "error");
          return;
        }

        showToast(getFriendlyLoginError(err), "error");
        throw err;
      }

      if (!account) {
        throw new Error(t("auth.login.validationError") ?? undefined);
      }

      await importData(account, progressItems, bookmarkItems);
      await restore(account);

      if (data.rememberMe) {
        window.electronAPI?.secureStoreSave?.(
          "saved_login",
          JSON.stringify({
            username: data.nickname,
            password: data.password,
          }),
        );
      } else {
        window.electronAPI?.secureStoreRemove?.("saved_login");
      }

      onLogin?.();
    },
    [
      bookmarkItems,
      getFriendlyLoginError,
      importData,
      login,
      onLogin,
      progressItems,
      restore,
      showToast,
      t,
    ],
  );

  const globalError = result.error || passkeyResult.error;

  return {
    nicknameError,
    passwordError,
    showRecovery,
    setShowRecovery,
    backendUrl,
    result,
    passkeyResult,
    globalError,
    getFriendlyLoginError,
    execute,
    executePasskey,
  };
}
