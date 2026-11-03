import { Trans, useTranslation } from "react-i18next";

import { isPasskeySupported } from "@/backend/accounts/crypto";
import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import { BrandPill } from "@/components/layout/BrandPill";
import { LargeCard, LargeCardText } from "@/components/layout/LargeCard";
import { MwLink } from "@/components/text/Link";
import { useLoginForm } from "@/hooks/auth/useLoginForm";

import { PasswordInputPart } from "./PasswordInputPart";
import { PasswordRecoveryPart } from "./PasswordRecoveryPart";

interface LoginFormPartProps {
  onLogin?: () => void;
  onRegister?: () => void;
}

export function LoginFormPart(props: LoginFormPartProps) {
  const { t } = useTranslation();
  const {
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
  } = useLoginForm(props.onLogin);

  if (showRecovery && backendUrl) {
    return (
      <PasswordRecoveryPart
        backendUrl={backendUrl}
        onComplete={props.onLogin}
        onBack={() => setShowRecovery(false)}
      />
    );
  }

  return (
    <LargeCard compact top={<BrandPill />}>
      <LargeCardText compact title={t("auth.login.title")}>
        {t("auth.login.description")}
      </LargeCardText>
      <div className="space-y-4">
        <PasswordInputPart
          forLogin
          compact
          onNext={execute}
          externalNicknameError={nicknameError}
          externalPasswordError={passwordError}
          submitLoading={result.loading}
        />
        {isPasskeySupported() && (
          <div className="relative mb-4">
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-background-main text-type-secondary">
                  {t("auth.login.or")}
                </span>
              </div>
            </div>
            <Button
              theme="secondary"
              onClick={() => void executePasskey()}
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
        <button
          type="button"
          className="w-full text-sm text-type-link hover:underline"
          onClick={() => setShowRecovery(true)}
        >
          {t("auth.otp.forgotLink", "Forgot your password?")}
        </button>
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
