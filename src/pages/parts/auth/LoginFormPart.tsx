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
import {
  LargeCard,
  LargeCardButtons,
  LargeCardText,
} from "@/components/layout/LargeCard";
import { MwLink } from "@/components/text/Link";
import { AuthInputBox } from "@/components/text-inputs/AuthInputBox";
import { useAuth } from "@/hooks/auth/useAuth";
import { useBackendUrl } from "@/hooks/auth/useBackendUrl";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useProgressStore } from "@/stores/progress";

interface LoginFormPartProps {
  onLogin?: () => void;
}

export function LoginFormPart(props: LoginFormPartProps) {
  const [mnemonic, setMnemonic] = useState("");
  const { login, restore, importData } = useAuth();
  const backendUrl = useBackendUrl();
  const progressItems = useProgressStore((store) => store.items);
  const bookmarkItems = useBookmarkStore((store) => store.bookmarks);
  const { t } = useTranslation();

  const [passkeyResult, executePasskey] = useAsyncFn(async () => {
    if (!backendUrl) {
      throw new Error(t("auth.login.noBackendUrl") ?? "No backend URL");
    }

    // Authenticate with passkey (no credential ID specified, browser will show all available)
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
  }, [props, login, restore, backendUrl, t, progressItems, bookmarkItems]);

  const [result, execute] = useAsyncFn(
    async (inputMnemonic: string) => {
      if (!verifyValidMnemonic(inputMnemonic))
        throw new Error(t("auth.login.validationError") ?? undefined);

      let account: AsyncReturnType<typeof login>;
      try {
        account = await login({
          mnemonic: inputMnemonic,
          userData: {
            device: "Browser",
          },
        });
      } catch (err) {
        if ((err as any).status === 401)
          throw new Error(t("auth.login.validationError") ?? undefined);
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

  return (
    <LargeCard top={<BrandPill backgroundClass="bg-[#161527]" />}>
      <LargeCardText title={t("auth.login.title")}>
        {t("auth.login.description")}
      </LargeCardText>
      <div className="space-y-4">
        <AuthInputBox
          label={t("auth.login.passphraseLabel") ?? undefined}
          value={mnemonic}
          autoComplete="username"
          name="username"
          onChange={setMnemonic}
          placeholder={t("auth.login.passphrasePlaceholder") ?? undefined}
          passwordToggleable
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
        {(result.error || passkeyResult.error) &&
        !result.loading &&
        !passkeyResult.loading ? (
          <p className="text-authentication-errorText">
            {result.error?.message || passkeyResult.error?.message}
          </p>
        ) : null}
      </div>

      <LargeCardButtons>
        <Button
          theme="purple"
          loading={result.loading}
          onClick={() => execute(mnemonic)}
        >
          {t("auth.login.submit")}
        </Button>
      </LargeCardButtons>
      <p className="text-center mt-6">
        <Trans i18nKey="auth.createAccount">
          <MwLink to="/register">.</MwLink>
        </Trans>
      </p>
    </LargeCard>
  );
}
