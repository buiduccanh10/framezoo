import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import type { AsyncReturnType } from "type-fest";

import {
  authenticatePasskey,
  isPasskeySupported,
  verifyValidMnemonic,
} from "@/backend/accounts/crypto";
import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import { BrandPill } from "@/components/layout/BrandPill";
import { LargeCard, LargeCardText } from "@/components/layout/LargeCard";
import { MwLink } from "@/components/text/Link";
import { useAuth } from "@/hooks/auth/useAuth";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useProgressStore } from "@/stores/progress";

import { type PasswordInputData, PasswordInputPart } from "./PasswordInputPart";

interface LoginFormPartProps {
  onLogin?: () => void;
  onRegister?: () => void;
}

export function LoginFormPart(props: LoginFormPartProps) {
  const { login, restore, importData } = useAuth();
  const progressItems = useProgressStore((store) => store.items);
  const bookmarkItems = useBookmarkStore((store) => store.bookmarks);
  const backendUrl = useBackendUrl();
  const { t } = useTranslation();

  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

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
      message.includes("user cannot be found") ||
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

    props.onLogin?.();
  }, [props, login, restore, t, progressItems, bookmarkItems, backendUrl]);

  const [result, execute] = useAsyncFn(
    async (data: PasswordInputData) => {
      // clear previous field errors
      setNicknameError(null);
      setPasswordError(null);

      // Password UI field is actually the mnemonic/passphrase
      if (!verifyValidMnemonic(data.password))
        throw new Error(t("auth.login.validationError") ?? undefined);

      let account: AsyncReturnType<typeof login>;
      try {
        account = await login({
          nickname: data.nickname,
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

        // Nickname not found
        if (status === 401 && beMessage.includes("User cannot be found")) {
          setNicknameError(
            t("auth.login.nicknameNotFound") ?? "Nickname not found",
          );
          return;
        }

        // Password / passphrase incorrect (invalid signature or generic 401)
        if (beMessage.includes("Invalid signature") || status === 401) {
          setPasswordError(
            t("auth.login.passwordIncorrect") ?? "Password is incorrect",
          );
          return;
        }

        throw err;
      }

      if (!account)
        throw new Error(t("auth.login.validationError") ?? undefined);

      await importData(account, progressItems, bookmarkItems);

      await restore(account);

      props.onLogin?.();
    },
    [props, login, restore, t, progressItems, bookmarkItems],
  );

  const handlePasswordSubmit = (data: PasswordInputData) => {
    execute(data);
  };

  const globalError = result.error || passkeyResult.error;

  return (
    <LargeCard compact top={<BrandPill backgroundClass="bg-[#161527]" />}>
      <LargeCardText compact title={t("auth.login.title")}>
        {t("auth.login.description")}
      </LargeCardText>
      <div className="space-y-4">
        <PasswordInputPart
          forLogin
          compact
          onNext={handlePasswordSubmit}
          externalNicknameError={nicknameError}
          externalPasswordError={passwordError}
          submitLoading={result.loading}
        />
        {isPasskeySupported() && (
          <div className="relative mb-4">
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-authentication-border/50" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-authentication-bg text-authentication-text">
                  {t("auth.login.or")}
                </span>
              </div>
            </div>
            <Button
              theme="secondary"
              onClick={() => executePasskey()}
              loading={passkeyResult.loading}
              disabled={passkeyResult.loading || result.loading}
              className="w-full"
            >
              <Icon icon={Icons.LOCK} className="mr-2" />
              {t("auth.login.usePasskey")}
            </Button>
          </div>
        )}
        {globalError && !result.loading && !passkeyResult.loading ? (
          <p className="text-authentication-errorText">
            {getFriendlyLoginError(globalError)}
          </p>
        ) : null}
      </div>
      <p className="text-center mt-4 sm:mt-6">
        <Trans i18nKey="auth.createAccount">
          <MwLink
            {...(props.onRegister
              ? { onClick: props.onRegister }
              : { to: "/register" })}
          >
            .
          </MwLink>
        </Trans>
      </p>
    </LargeCard>
  );
}
